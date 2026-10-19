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
import { endSession, findSession, requireUser, startSession } from '../../lib/session.ts'

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
    const isFirst = (await db.user.count()) === 0
    if (!isFirst && !config.ALLOW_SIGNUP) throw forbidden('Sign-up is closed. Ask an admin to add you.')
    if (await db.user.findUnique({ where: { email: body.email } })) throw badRequest('That email is already registered')

    const user = await db.user.create({
      data: { name: body.name, email: body.email, passwordHash: await hashPassword(body.password), role: isFirst ? 'admin' : 'user' },
    })
    await startSession(request, reply, user.id, false)
    return { ok: true }
  })

  app.post('/login', strict, async (request, reply) => {
    const body = parse(z.object({ email, password: z.string() }), request.body)
    const user = await db.user.findUnique({ where: { email: body.email } })
    const valid = await verifyPassword(body.password, user?.passwordHash ?? (await dummyHash))
    if (!user || !valid) throw new HttpError(401, 'Wrong email or password')

    await startSession(request, reply, user.id, user.totpEnabled)
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
        await db.user.update({ where: { id: user.id }, data: { recoveryCodes: user.recoveryCodes.filter((c) => c !== hash) } })
      }
    }
    if (!ok) throw new HttpError(401, 'That code is not valid')

    // Swap the half-signed-in session for a fresh one, so the old token is worthless.
    await db.session.delete({ where: { id: session.id } })
    await startSession(request, reply, user.id, false)
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
      return db.preference.upsert({ where: { userId: request.user.id }, create: { userId: request.user.id, ...body }, update: body })
    })

    signedIn.post('/password', strict, async (request) => {
      const body = parse(z.object({ current: z.string(), next: password }), request.body)
      const user = await db.user.findUniqueOrThrow({ where: { id: request.user.id } })
      if (!(await verifyPassword(body.current, user.passwordHash))) throw badRequest('Your current password is wrong')
      await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.next) } })
      // Sign out every other device.
      await db.session.deleteMany({ where: { userId: user.id, NOT: { id: request.sessionId } } })
      return { ok: true }
    })

    // 2FA setup: create a secret, show it as a QR code, and only turn 2FA on once a code checks out.
    signedIn.post('/2fa/setup', async (request) => {
      const secret = authenticator.generateSecret()
      await db.user.update({ where: { id: request.user.id }, data: { totpSecret: encrypt(secret) } })
      const otpauthUrl = authenticator.keyuri(request.user.email, 'Nexus', secret)
      return { secret, otpauthUrl, qrCode: await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 }) }
    })

    signedIn.post('/2fa/enable', strict, async (request) => {
      const { code } = parse(z.object({ code: z.string() }), request.body)
      const user = await db.user.findUniqueOrThrow({ where: { id: request.user.id } })
      if (!user.totpSecret || !authenticator.verify({ token: code.replace(/\s/g, ''), secret: decrypt(user.totpSecret) })) {
        throw badRequest('That code is not valid. Check the time on your phone and try again.')
      }
      const recoveryCodes = await newRecoveryCodes(user.id, { totpEnabled: true })
      return { recoveryCodes }
    })

    signedIn.post('/2fa/disable', strict, async (request) => {
      const { password: current } = parse(z.object({ password: z.string() }), request.body)
      const user = await db.user.findUniqueOrThrow({ where: { id: request.user.id } })
      if (!(await verifyPassword(current, user.passwordHash))) throw badRequest('Wrong password')
      await db.user.update({ where: { id: user.id }, data: { totpEnabled: false, totpSecret: null, recoveryCodes: [] } })
      return { ok: true }
    })

    signedIn.post('/2fa/recovery-codes', strict, async (request) => {
      const { password: current } = parse(z.object({ password: z.string() }), request.body)
      const user = await db.user.findUniqueOrThrow({ where: { id: request.user.id } })
      if (!(await verifyPassword(current, user.passwordHash))) throw badRequest('Wrong password')
      if (!user.totpEnabled) throw badRequest('Turn on two-factor authentication first')
      return { recoveryCodes: await newRecoveryCodes(user.id) }
    })

    signedIn.get('/sessions', async (request) => {
      const sessions = await db.session.findMany({ where: { userId: request.user.id, pending2fa: false }, orderBy: { lastSeenAt: 'desc' } })
      return sessions.map((s) => ({ id: s.id, userAgent: s.userAgent, ip: s.ip, lastSeenAt: s.lastSeenAt, current: s.id === request.sessionId }))
    })

    signedIn.delete<{ Params: { id: string } }>('/sessions/:id', async (request) => {
      await db.session.deleteMany({ where: { id: request.params.id, userId: request.user.id } })
      return { ok: true }
    })
  })
}

// Ten single-use codes, shown once. Only their hashes are kept.
async function newRecoveryCodes(userId: string, extra: { totpEnabled?: boolean } = {}) {
  const codes = Array.from({ length: 10 }, () => randomBytes(5).toString('hex').replace(/(.{5})/, '$1-')) // e.g. "3f9a1-0c7d2"
  await db.user.update({ where: { id: userId }, data: { ...extra, recoveryCodes: codes.map((c) => sha256(normalizeCode(c))) } })
  return codes
}

// People type codes with or without the dash, in any case.
const normalizeCode = (code: string) => code.replace(/[\s-]/g, '').toLowerCase()
