// Sign up, sign in, two-factor authentication, password and session management.
import type { KeyObject } from 'node:crypto'
import type { User } from '@prisma/client'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { authenticator } from 'otplib'
import QRCode from 'qrcode'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { config } from '../../config.ts'
import { db } from '../../db.ts'
import { decrypt, encrypt, hashPassword, randomToken, sha256, verifyPassword } from '../../lib/crypto.ts'
import { HttpError, badRequest, errorMessage, forbidden, parse } from '../../lib/http.ts'
import {
  lockWithPassword,
  newStorageKeys,
  unlockWithPassword,
  unlockWithToken,
  type StorageKeys,
} from '../../lib/sealed.ts'
import {
  endSession,
  findSession,
  requireUser,
  sessionToken,
  setSessionStorageKey,
  startSession,
} from '../../lib/session.ts'
import { unsealUserMail } from '../mail/private.ts'
import { queueSync } from '../../jobs/queue.ts'

// Accept the code before and after the current one: phone clocks drift and people type slowly.
authenticator.options = { window: 1 }

// Authenticator codes change every 30 seconds; each 30-second slot since 1970 is a "step".
// Returns the step a code belongs to, or null when the code is wrong.
function codeStep(code: string, secret: string): number | null {
  const delta = authenticator.checkDelta(code.replace(/\s/g, ''), secret) // -1, 0 or 1 steps from now
  if (delta === null) return null
  return Math.floor(Date.now() / 30_000) + delta
}

// Accepts a code only if it is newer than the last one used, so a code someone saw can't be used again.
// One database update does the check and the save together, so two requests with the same code
// at the same moment can't both get in.
async function useCode(userId: string, code: string, secret: string): Promise<boolean> {
  const step = codeStep(code, secret)
  if (step === null) return false
  const used = await db.user.updateMany({
    where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
    data: { totpLastStep: step },
  })
  return used.count === 1
}

const email = z.string().trim().toLowerCase().email()
const password = z.string().min(12, 'Use at least 12 characters').max(200)
// The secret authenticator apps share with us: base32 (letters A–Z and digits 2–7), 16 or more characters.
const BASE32_SECRET = /^[A-Z2-7]{16,}$/

// Endpoints that check a password or code allow 10 tries a minute from one address, against guessing.
const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }

// Compared against when the email is unknown, so a wrong email takes as long as a wrong password.
const dummyHash = hashPassword(randomToken())

export async function authRoutes(app: FastifyInstance) {
  app.get('/status', async () => ({
    needsSetup: (await db.user.count()) === 0,
    allowSignup: config.ALLOW_SIGNUP,
    // Which "sign in with…" buttons work for adding mail accounts: only those with a client ID and secret.
    oauth: {
      google: Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
      microsoft: Boolean(config.MICROSOFT_CLIENT_ID && config.MICROSOFT_CLIENT_SECRET),
    },
  }))

  // The first person to sign up becomes the admin. After that, only if ALLOW_SIGNUP=true.
  app.post('/signup', strict, async (request, reply) => {
    const body = parse(z.object({ name: z.string().trim().min(1), email, password }), request.body)
    const passwordHash = await hashPassword(body.password)
    // Count and create in one serializable transaction: two people setting up at the same moment
    // must not both become admin. The one that loses the race gets an error and can try again.
    const user = await db
      .$transaction(
        async (tx) => {
          const isFirst = (await tx.user.count()) === 0
          if (!isFirst && !config.ALLOW_SIGNUP) throw forbidden('Sign-up is closed. Ask an admin to add you.')
          if (await tx.user.findUnique({ where: { email: body.email } }))
            throw badRequest('That email is already registered')
          return tx.user.create({
            data: { name: body.name, email: body.email, passwordHash, role: isFirst ? 'admin' : 'user' },
          })
        },
        { isolationLevel: 'Serializable' },
      )
      .catch((error) => {
        if ((error as { code?: string }).code === 'P2034')
          throw new HttpError(409, 'Someone else is signing up at the same moment. Try again.')
        throw error
      })
    await startSession(request, reply, user.id, false)
    return { ok: true }
  })

  app.post('/login', strict, async (request, reply) => {
    const body = parse(z.object({ email, password: z.string() }), request.body)
    const user = await db.user.findUnique({ where: { email: body.email } })
    const valid = await verifyPassword(body.password, user?.passwordHash ?? (await dummyHash))
    if (!user || !valid) throw new HttpError(401, 'Wrong email or password')

    // Private storage: the password is in hand only now, so unlock the key and hand it to the session.
    const key = user.storagePrivateKey ? await unlockWithPassword(user.storagePrivateKey, body.password) : undefined
    // The second step: a code from an authenticator app, or a security key (see passkeys.ts).
    const securityKeys = await db.passkey.count({ where: { userId: user.id, kind: 'security-key' } })
    const twoFactorRequired = user.totpEnabled || securityKeys > 0
    await startSession(request, reply, user.id, twoFactorRequired, key)
    // Private storage was turned off, but opening the mail again may have been cut short by a restart.
    if (key && !user.privateStorage) unsealInBackground(user.id, key)
    return { twoFactorRequired, methods: { code: user.totpEnabled, securityKey: securityKeys > 0 } }
  })

  // Second step of sign-in: a code from the authenticator app, or a one-time recovery code.
  app.post('/2fa', strict, async (request, reply) => {
    const body = parse(z.object({ code: z.string().optional(), recoveryCode: z.string().optional() }), request.body)
    const session = await findSession(request)
    if (!session?.pending2fa) throw new HttpError(401, 'Sign in with your password first')
    const user = session.user

    let ok = false
    if (body.code && user.totpSecret) {
      ok = await useCode(user.id, body.code, decrypt(user.totpSecret))
    } else if (body.recoveryCode) {
      const hash = sha256(normalizeCode(body.recoveryCode))
      if (user.recoveryCodes.includes(hash)) {
        ok = true
        await db.user.update({
          where: { id: user.id },
          data: { recoveryCodes: user.recoveryCodes.filter((c) => c !== hash) },
        })
      }
    }
    if (!ok) throw new HttpError(401, 'That code is not valid')

    // Swap the half-signed-in session for a fresh one, so the old token is worthless.
    const key = session.storageKey ? await unlockWithToken(session.storageKey, sessionToken(request)!) : undefined
    await db.session.delete({ where: { id: session.id } })
    await startSession(request, reply, user.id, false, key)
    return { ok: true }
  })

  app.post('/logout', async (request, reply) => {
    await endSession(request, reply)
    return { ok: true }
  })

  // ---------- Everything below needs a signed-in user ----------

  app.register(async (signedIn) => {
    signedIn.addHook('preHandler', requireUser)

    signedIn.get('/me', async (request) => {
      const user = await db.user.findUniqueOrThrow({ where: { id: request.user.id }, include: { preference: true } })
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        totpEnabled: user.totpEnabled,
        privateStorage: user.privateStorage,
        recoveryCodesLeft: user.recoveryCodes.length,
        preferences: user.preference ?? {
          theme: 'system',
          layout: 'three-pane',
          spamThreshold: 5,
          feedRetentionDays: null,
          undoSendSeconds: 5,
        },
      }
    })

    signedIn.put('/me/preferences', async (request) => {
      const body = parse(
        z.object({
          theme: z.enum(['system', 'dark', 'light']).optional(),
          layout: z.enum(['three-pane', 'list']).optional(),
          spamThreshold: z.number().min(1).max(20).optional(),
          feedRetentionDays: z.number().int().min(1).max(3650).nullable().optional(), // null = keep feed posts forever
          undoSendSeconds: z.number().int().min(0).max(30).optional(), // 0 = send at once
        }),
        request.body,
      )
      return db.preference.upsert({
        where: { userId: request.user.id },
        create: { userId: request.user.id, ...body },
        update: body,
      })
    })

    signedIn.post('/password', strict, async (request) => {
      const body = parse(z.object({ current: z.string(), next: password }), request.body)
      const user = await userWithPassword(request.user.id, body.current, 'Your current password is wrong')
      // The private-storage key is locked with the password, so unlock it with the old one
      // and lock it again with the new one.
      let storagePrivateKey: string | undefined
      if (user.storagePrivateKey) {
        const key = await unlockWithPassword(user.storagePrivateKey, body.current)
        storagePrivateKey = await lockWithPassword(key, body.next)
      }
      await db.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(body.next), storagePrivateKey },
      })
      // Sign out every other device.
      await db.session.deleteMany({ where: { userId: user.id, NOT: { id: request.sessionId } } })
      return { ok: true }
    })

    // 2FA setup: create a secret and show it as a QR code. Nothing is saved until a code from it checks out,
    // so moving to a new phone can be cancelled halfway without breaking the old one.
    signedIn.post('/2fa/setup', async (request) => {
      const secret = authenticator.generateSecret()
      const otpauthUrl = authenticator.keyuri(request.user.email, 'Nexus', secret)
      const qrCode = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 }) // a PNG image as a data: URL
      return { secret, otpauthUrl, qrCode }
    })

    signedIn.post('/2fa/enable', strict, async (request) => {
      const { code, secret } = parse(
        z.object({ code: z.string(), secret: z.string().regex(BASE32_SECRET) }),
        request.body,
      )
      const step = codeStep(code, secret)
      if (step === null) throw badRequest('That code is not valid. Check the time on your phone and try again.')
      const recoveryCodes = await newRecoveryCodes(request.user.id, {
        totpEnabled: true,
        totpSecret: encrypt(secret),
        totpLastStep: step, // this code is now used up
      })
      return { recoveryCodes }
    })

    signedIn.post('/2fa/disable', strict, async (request) => {
      const { password: current } = parse(z.object({ password: z.string() }), request.body)
      const user = await userWithPassword(request.user.id, current)
      // Recovery codes stay while a security key is still the second step.
      const securityKeys = await db.passkey.count({ where: { userId: user.id, kind: 'security-key' } })
      await db.user.update({
        where: { id: user.id },
        data: {
          totpEnabled: false,
          totpSecret: null,
          totpLastStep: null,
          ...(securityKeys === 0 && { recoveryCodes: [] }),
        },
      })
      return { ok: true }
    })

    signedIn.post('/2fa/recovery-codes', strict, async (request) => {
      const { password: current } = parse(z.object({ password: z.string() }), request.body)
      const user = await userWithPassword(request.user.id, current)
      const securityKeys = await db.passkey.count({ where: { userId: user.id, kind: 'security-key' } })
      if (!user.totpEnabled && !securityKeys) throw badRequest('Turn on two-factor authentication first')
      return { recoveryCodes: await newRecoveryCodes(user.id) }
    })

    // Private storage on or off. See lib/sealed.ts and the README for what it does and doesn't protect.
    signedIn.post('/private-storage', strict, async (request) => {
      const body = parse(z.object({ enabled: z.boolean(), password: z.string() }), request.body)
      const user = await userWithPassword(request.user.id, body.password)
      if (body.enabled) await turnOnPrivateStorage(request, user, body.password)
      else await turnOffPrivateStorage(user, body.password)
      return { ok: true }
    })

    signedIn.get('/sessions', async (request) => {
      const sessions = await db.session.findMany({
        where: { userId: request.user.id, pending2fa: false },
        orderBy: { lastSeenAt: 'desc' },
      })
      return sessions.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        ip: s.ip,
        lastSeenAt: s.lastSeenAt,
        current: s.id === request.sessionId,
      }))
    })

    signedIn.delete<{ Params: { id: string } }>('/sessions/:id', async (request) => {
      await db.session.deleteMany({ where: { id: request.params.id, userId: request.user.id } })
      return { ok: true }
    })
  })
}

// Loads the signed-in user, after checking the password they typed to confirm a sensitive change.
async function userWithPassword(userId: string, typed: string, wrongMessage = 'Wrong password'): Promise<User> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } })
  if (!(await verifyPassword(typed, user.passwordHash))) throw badRequest(wrongMessage)
  return user
}

async function turnOnPrivateStorage(request: FastifyRequest, user: User, password: string) {
  const owned = await db.account.findMany({
    where: { ownerId: user.id },
    include: { _count: { select: { members: true } } },
  })
  const pop3 = owned.filter((a) => a.protocol === 'pop3').map((a) => a.email)
  if (pop3.length) {
    throw badRequest(
      `POP3 accounts can't use private storage, because Nexus holds the only copy of their mail: ${pop3.join(', ')}`,
    )
  }
  const shared = owned.filter((a) => a._count.members > 0).map((a) => a.email)
  if (shared.length) {
    throw badRequest(`Stop sharing ${shared.join(', ')} first. People you share with couldn't read private mail.`)
  }

  // Reuse the old key if private storage was on before, so mail sealed back then still opens.
  let keys: StorageKeys
  if (user.storagePrivateKey) {
    keys = { privateKey: await unlockWithPassword(user.storagePrivateKey, password), publicKey: user.storagePublicKey! }
  } else {
    keys = newStorageKeys()
  }
  const storagePrivateKey = await lockWithPassword(keys.privateKey, password)
  await db.user.update({
    where: { id: user.id },
    data: { privateStorage: true, storagePublicKey: keys.publicKey, storagePrivateKey },
  })
  await setSessionStorageKey(request, keys.privateKey)

  // Other devices have no key and couldn't read anything; signing in again gives them one.
  await db.session.deleteMany({ where: { userId: user.id, NOT: { id: request.sessionId } } })
  // The mail itself is sealed in the background, by each account's next sync (sealing only needs
  // the public key), so a big mailbox doesn't hold up this request. New mail is sealed as it arrives.
  for (const account of owned) await queueSync(account.id)
}

async function turnOffPrivateStorage(user: User, password: string) {
  if (!user.storagePrivateKey) return // was never on
  // The keys are kept, not deleted: mail that a sync is sealing right now must still open later.
  await db.user.update({ where: { id: user.id }, data: { privateStorage: false } })
  const key = await unlockWithPassword(user.storagePrivateKey, password)
  unsealInBackground(user.id, key)
}

// Opening mail needs the private key, which must never be written to the job queue (Redis), so it
// runs right here in the server, after the answer is sent. If Nexus restarts before it's done, the
// next sign-in carries on (see /login), since signing in unlocks the key again.
function unsealInBackground(userId: string, key: KeyObject) {
  unsealUserMail(userId, key).catch((error) =>
    console.warn(`Could not open private mail again: ${errorMessage(error)}`),
  )
}

// Ten single-use codes like "3f9a1-0c7d2", shown once. Only their hashes are kept.
export async function newRecoveryCodes(
  userId: string,
  extra: { totpEnabled?: boolean; totpSecret?: string; totpLastStep?: number } = {},
) {
  const codes = Array.from({ length: 10 }, () => {
    const hex = randomBytes(5).toString('hex') // 10 random characters
    return `${hex.slice(0, 5)}-${hex.slice(5)}`
  })
  await db.user.update({
    where: { id: userId },
    data: { ...extra, recoveryCodes: codes.map((c) => sha256(normalizeCode(c))) },
  })
  return codes
}

// People type codes with or without the dash, in any case.
const normalizeCode = (code: string) => code.replace(/[\s-]/g, '').toLowerCase()
