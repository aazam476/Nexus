// Sign up, sign in, two-factor authentication, password and session management.
import type { FastifyInstance } from 'fastify'
import { authenticator } from 'otplib'
import QRCode from 'qrcode'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { config } from '../../config.ts'
import { db } from '../../db.ts'
import { decrypt, encrypt, hashPassword, randomToken, sha256, verifyPassword } from '../../lib/crypto.ts'
import { HttpError, badRequest, forbidden, parse } from '../../lib/http.ts'
import { lockWithPassword, newStorageKeys, unlockWithPassword, unlockWithToken } from '../../lib/sealed.ts'
import {
  endSession,
  findSession,
  requireUser,
  sessionToken,
  setSessionStorageKey,
  startSession,
} from '../../lib/session.ts'
import { sealAccounts, unsealAccounts } from '../mail/private.ts'

// Accept the code before and after the current one: phone clocks drift and people type slowly.
// shortcut: a code can be reused within its 30s window; store the last used step per user if that matters.
authenticator.options = { window: 1 }

const email = z.string().trim().toLowerCase().email()
const password = z.string().min(12, 'Use at least 12 characters').max(200)
const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }

// Compared against when the email is unknown, so a wrong email takes as long as a wrong password.
const dummyHash = hashPassword(randomToken())

export async function authRoutes(app: FastifyInstance) {
  app.get('/status', async () => ({
    needsSetup: (await db.user.count()) === 0,
    allowSignup: config.ALLOW_SIGNUP,
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
    await startSession(request, reply, user.id, user.totpEnabled, key)
    return { twoFactorRequired: user.totpEnabled }
  })

  // Second step of sign-in: a code from the authenticator app, or a one-time recovery code.
  app.post('/2fa', strict, async (request, reply) => {
    const body = parse(z.object({ code: z.string().optional(), recoveryCode: z.string().optional() }), request.body)
    const session = await findSession(request)
    if (!session?.pending2fa) throw new HttpError(401, 'Sign in with your password first')
    const user = session.user

    let ok = false
    if (body.code && user.totpSecret) {
      ok = authenticator.verify({ token: body.code.replace(/\s/g, ''), secret: decrypt(user.totpSecret) })
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
        preferences: user.preference ?? { theme: 'system', layout: 'three-pane', spamThreshold: 5 },
      }
    })

    signedIn.put('/me/preferences', async (request) => {
      const body = parse(
        z.object({
          theme: z.enum(['system', 'dark', 'light']).optional(),
          layout: z.enum(['three-pane', 'list']).optional(),
          spamThreshold: z.number().min(1).max(20).optional(),
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
      const user = await db.user.findUniqueOrThrow({ where: { id: request.user.id } })
      if (!(await verifyPassword(body.current, user.passwordHash))) throw badRequest('Your current password is wrong')
      // The private-storage key is locked with the password, so lock it again with the new one.
      const storagePrivateKey = user.storagePrivateKey
        ? await lockWithPassword(await unlockWithPassword(user.storagePrivateKey, body.current), body.next)
        : undefined
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
      return { secret, otpauthUrl, qrCode: await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 }) }
    })

    signedIn.post('/2fa/enable', strict, async (request) => {
      const { code, secret } = parse(
        z.object({ code: z.string(), secret: z.string().regex(/^[A-Z2-7]{16,}$/) }),
        request.body,
      )
      if (!authenticator.verify({ token: code.replace(/\s/g, ''), secret })) {
        throw badRequest('That code is not valid. Check the time on your phone and try again.')
      }
      const recoveryCodes = await newRecoveryCodes(request.user.id, { totpEnabled: true, totpSecret: encrypt(secret) })
      return { recoveryCodes }
    })

    signedIn.post('/2fa/disable', strict, async (request) => {
      const { password: current } = parse(z.object({ password: z.string() }), request.body)
      const user = await db.user.findUniqueOrThrow({ where: { id: request.user.id } })
      if (!(await verifyPassword(current, user.passwordHash))) throw badRequest('Wrong password')
      await db.user.update({
        where: { id: user.id },
        data: { totpEnabled: false, totpSecret: null, recoveryCodes: [] },
      })
      return { ok: true }
    })

    signedIn.post('/2fa/recovery-codes', strict, async (request) => {
      const { password: current } = parse(z.object({ password: z.string() }), request.body)
      const user = await db.user.findUniqueOrThrow({ where: { id: request.user.id } })
      if (!(await verifyPassword(current, user.passwordHash))) throw badRequest('Wrong password')
      if (!user.totpEnabled) throw badRequest('Turn on two-factor authentication first')
      return { recoveryCodes: await newRecoveryCodes(user.id) }
    })

    // Private storage on or off. See lib/sealed.ts and the README for what it does and doesn't protect.
    signedIn.post('/private-storage', strict, async (request) => {
      const body = parse(z.object({ enabled: z.boolean(), password: z.string() }), request.body)
      const user = await db.user.findUniqueOrThrow({ where: { id: request.user.id } })
      if (!(await verifyPassword(body.password, user.passwordHash))) throw badRequest('Wrong password')
      const owned = await db.account.findMany({
        where: { ownerId: user.id },
        include: { _count: { select: { members: true } } },
      })
      const accountIds = owned.map((a) => a.id)

      if (body.enabled) {
        const pop3 = owned.filter((a) => a.protocol === 'pop3').map((a) => a.email)
        if (pop3.length)
          throw badRequest(
            `POP3 accounts can't use private storage, because Nexus holds the only copy of their mail: ${pop3.join(', ')}`,
          )
        const shared = owned.filter((a) => a._count.members > 0).map((a) => a.email)
        if (shared.length)
          throw badRequest(`Stop sharing ${shared.join(', ')} first. People you share with couldn't read private mail.`)

        // Reuse the old key if private storage was on before, so mail sealed back then still opens.
        const keys = user.storagePrivateKey
          ? {
              privateKey: await unlockWithPassword(user.storagePrivateKey, body.password),
              publicKey: user.storagePublicKey!,
            }
          : newStorageKeys()
        await db.user.update({
          where: { id: user.id },
          data: {
            privateStorage: true,
            storagePublicKey: keys.publicKey,
            storagePrivateKey: await lockWithPassword(keys.privateKey, body.password),
          },
        })
        await setSessionStorageKey(request, keys.privateKey)
        // Other devices have no key and couldn't read anything; signing in again gives them one.
        await db.session.deleteMany({ where: { userId: user.id, NOT: { id: request.sessionId } } })
        // shortcut: seals the whole mailbox inside this request; move it to the job queue if mailboxes get huge.
        await sealAccounts(accountIds, keys.publicKey)
      } else {
        if (!user.storagePrivateKey) return { ok: true }
        // Keys are kept: mail a running sync seals right now must still open later.
        await db.user.update({ where: { id: user.id }, data: { privateStorage: false } })
        await unsealAccounts(accountIds, await unlockWithPassword(user.storagePrivateKey, body.password))
      }
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

// Ten single-use codes, shown once. Only their hashes are kept.
async function newRecoveryCodes(userId: string, extra: { totpEnabled?: boolean; totpSecret?: string } = {}) {
  const codes = Array.from({ length: 10 }, () =>
    randomBytes(5)
      .toString('hex')
      .replace(/(.{5})/, '$1-'),
  ) // e.g. "3f9a1-0c7d2"
  await db.user.update({
    where: { id: userId },
    data: { ...extra, recoveryCodes: codes.map((c) => sha256(normalizeCode(c))) },
  })
  return codes
}

// People type codes with or without the dash, in any case.
const normalizeCode = (code: string) => code.replace(/[\s-]/g, '').toLowerCase()
