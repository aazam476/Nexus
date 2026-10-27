// Passkeys and security keys (WebAuthn): Touch ID, Windows Hello, a phone, or a YubiKey.
//
// Every use is the same dance: the server makes a random "challenge", the browser asks the passkey to
// sign it, and the server checks the signature with the passkey's public key. The @simplewebauthn
// library does the checking; this file decides what each use is for:
//   - signing in without a password,
//   - the second step after a password, instead of an authenticator-app code,
//   - unlocking private storage. The private-storage key is locked with the password, so a sign-in
//     without one can't open it. Passkeys that support the PRF extension can produce a secret of their
//     own; a copy of the key is locked with that secret, so the passkey alone opens the mail too.
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { config } from '../../config.ts'
import { db } from '../../db.ts'
import { HttpError, badRequest, parse } from '../../lib/http.ts'
import { lockWithToken, unlockWithToken } from '../../lib/sealed.ts'
import { findSession, requireUser, sessionToken, startSession, storageKey } from '../../lib/session.ts'
import { redis } from '../../jobs/queue.ts'

const site = new URL(config.PUBLIC_URL)
const rpID = site.hostname // passkeys belong to this domain
const expectedOrigin = site.origin

// What a challenge was made for, so one made for adding a passkey can't be used to sign in, and so on.
type Purpose = 'register' | 'sign-in' | 'second-step' | 'storage'

// Challenges live in Redis for 5 minutes and can be used once. In Redis, not in a cookie, so a
// signed response can't be replayed.
async function saveChallenge(challenge: string, purpose: Purpose, userId = '') {
  await redis.set(`passkey-challenge:${challenge}`, JSON.stringify({ purpose, userId }), 'EX', 300)
}

// Finds the challenge the browser signed (it's inside clientDataJSON) and uses it up.
async function takeChallenge(clientDataJSON: string, purpose: Purpose, userId = ''): Promise<string> {
  const { challenge } = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8')) as { challenge: string }
  const saved = await redis.getdel(`passkey-challenge:${challenge}`)
  const ok = saved && JSON.parse(saved).purpose === purpose && JSON.parse(saved).userId === userId
  if (!ok) throw new HttpError(401, 'That took too long, or was already used. Try again.')
  return challenge
}

// The browser sends what the passkey signed. zod only checks the outline; the library checks the rest.
const signed = z
  .object({ id: z.string(), response: z.object({ clientDataJSON: z.string() }).passthrough() })
  .passthrough()

// Checks a passkey's signature on a challenge, and notes its use. `userId` limits it to one person's passkeys.
async function verifyPasskey(response: AuthenticationResponseJSON, purpose: Purpose, userId?: string) {
  const challenge = await takeChallenge(response.response.clientDataJSON, purpose, userId)
  const passkey = await db.passkey.findUnique({ where: { id: response.id }, include: { user: true } })
  if (!passkey || (userId && passkey.userId !== userId)) throw new HttpError(401, 'This passkey isn’t known here')
  const { verified, authenticationInfo } = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin,
    expectedRPID: rpID,
    requireUserVerification: true, // a fingerprint, face or PIN, not just a tap
    credential: { id: passkey.id, publicKey: passkey.publicKey, counter: passkey.counter },
  }).catch(() => ({ verified: false, authenticationInfo: undefined }))
  if (!verified || !authenticationInfo) throw new HttpError(401, 'The passkey’s signature didn’t check out')
  await db.passkey.update({
    where: { id: passkey.id },
    data: { counter: authenticationInfo.newCounter, lastUsedAt: new Date() },
  })
  return passkey
}

async function authenticationOptions(purpose: Purpose, userId?: string, onlyId?: string) {
  // For someone already known, list their passkeys (or just one); for a passwordless sign-in, the
  // browser offers whichever it has for this site.
  const passkeys = userId ? await db.passkey.findMany({ where: { userId, ...(onlyId && { id: onlyId }) } }) : []
  if (userId && !passkeys.length) throw badRequest('You haven’t added a passkey yet')
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'required',
    allowCredentials: passkeys.map((p) => ({ id: p.id, transports: p.transports as never })),
  })
  await saveChallenge(options.challenge, purpose, userId)
  return options
}

// The secret the passkey produced (PRF), sent by the browser next to the signed response.
const prfSecret = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Not a passkey secret') // 32 bytes, base64url

export async function passkeyRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }

  // Signing in without a password.
  app.post('/passkeys/sign-in/options', strict, async () => authenticationOptions('sign-in'))

  app.post('/passkeys/sign-in', strict, async (request, reply) => {
    const body = parse(z.object({ response: signed, prf: prfSecret.optional() }), request.body)
    const passkey = await verifyPasskey(body.response as unknown as AuthenticationResponseJSON, 'sign-in')
    const user = passkey.user
    // Private storage on: this passkey must be able to open it, or the mail would be unreadable.
    let key
    if (passkey.storageKey && body.prf) key = await unlockWithToken(passkey.storageKey, body.prf).catch(() => undefined)
    if (user.privateStorage && !key)
      throw new HttpError(401, 'This passkey can’t unlock your private storage. Sign in with your password.')
    // A passkey with a fingerprint, face or PIN is two steps in one, so no app code is asked for.
    await startSession(request, reply, user.id, false, key)
    return { ok: true }
  })

  // The second step after a password, instead of a code from the authenticator app.
  app.post('/passkeys/second-step/options', strict, async (request) => {
    const session = await findSession(request)
    if (!session?.pending2fa) throw new HttpError(401, 'Sign in with your password first')
    return authenticationOptions('second-step', session.userId)
  })

  app.post('/passkeys/second-step', strict, async (request, reply) => {
    const session = await findSession(request)
    if (!session?.pending2fa) throw new HttpError(401, 'Sign in with your password first')
    const { response } = parse(z.object({ response: signed }), request.body)
    await verifyPasskey(response as unknown as AuthenticationResponseJSON, 'second-step', session.userId)
    // Swap the half-signed-in session for a fresh one, as the code step does.
    const key = session.storageKey ? await unlockWithToken(session.storageKey, sessionToken(request)!) : undefined
    await db.session.delete({ where: { id: session.id } })
    await startSession(request, reply, session.userId, false, key)
    return { ok: true }
  })

  // Managing your passkeys, once signed in.
  app.register(async (signedIn) => {
    signedIn.addHook('preHandler', requireUser)

    signedIn.get('/passkeys', async (request) => {
      const passkeys = await db.passkey.findMany({ where: { userId: request.user.id }, orderBy: { createdAt: 'asc' } })
      return passkeys.map((p) => ({
        id: p.id,
        name: p.name,
        createdAt: p.createdAt,
        lastUsedAt: p.lastUsedAt,
        unlocksPrivateStorage: p.storageKey !== null,
      }))
    })

    signedIn.post('/passkeys/options', async (request) => {
      const existing = await db.passkey.findMany({ where: { userId: request.user.id } })
      const options = await generateRegistrationOptions({
        rpName: 'Nexus',
        rpID,
        userName: request.user.email,
        userDisplayName: request.user.name,
        userID: new TextEncoder().encode(request.user.id),
        attestationType: 'none', // we don't need to know the maker of the passkey
        excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports as never })),
        // A "discoverable" passkey can sign in without typing an email first.
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      })
      await saveChallenge(options.challenge, 'register', request.user.id)
      return options
    })

    signedIn.post('/passkeys', async (request) => {
      const body = parse(z.object({ name: z.string().trim().min(1).max(60), response: signed }), request.body)
      const response = body.response as unknown as RegistrationResponseJSON
      const challenge = await takeChallenge(response.response.clientDataJSON, 'register', request.user.id)
      const { verified, registrationInfo } = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin,
        expectedRPID: rpID,
        requireUserVerification: true,
      }).catch((error) => {
        throw badRequest(`This passkey couldn’t be added: ${(error as Error).message}`)
      })
      if (!verified || !registrationInfo) throw badRequest('This passkey couldn’t be added')
      const { credential } = registrationInfo
      await db.passkey.create({
        data: {
          id: credential.id,
          userId: request.user.id,
          name: body.name,
          publicKey: credential.publicKey,
          counter: credential.counter,
          transports: credential.transports ?? [],
        },
      })
      // With private storage, the browser should now ask the passkey for its secret (see below).
      return { id: credential.id, unlockStorage: (await storageKey(request)) !== null }
    })

    // Let a passkey unlock private storage: the browser signs a challenge and sends the passkey's secret,
    // and the key this session holds is locked with that secret.
    signedIn.post<{ Params: { id: string } }>('/passkeys/:id/storage/options', async (request) => {
      return authenticationOptions('storage', request.user.id, request.params.id)
    })

    signedIn.post<{ Params: { id: string } }>('/passkeys/:id/storage', async (request) => {
      const body = parse(z.object({ response: signed, prf: prfSecret }), request.body)
      const passkey = await verifyPasskey(
        body.response as unknown as AuthenticationResponseJSON,
        'storage',
        request.user.id,
      )
      if (passkey.id !== request.params.id) throw badRequest('That was a different passkey')
      const key = await storageKey(request)
      if (!key) throw badRequest('Private storage isn’t set up')
      await db.passkey.update({ where: { id: passkey.id }, data: { storageKey: lockWithToken(key, body.prf) } })
      return { ok: true }
    })

    signedIn.delete<{ Params: { id: string } }>('/passkeys/:id', async (request) => {
      await db.passkey.deleteMany({ where: { id: request.params.id, userId: request.user.id } })
      return { ok: true }
    })
  })
}
