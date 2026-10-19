// Sign-in sessions: an httpOnly cookie holding a random token. The database only stores its hash.
import type { KeyObject } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { config, secureCookies } from '../config.ts'
import { db } from '../db.ts'
import { randomToken, sha256 } from './crypto.ts'
import { HttpError } from './http.ts'
import { lockWithToken, unlockWithToken } from './sealed.ts'

const COOKIE = 'nexus_session'
const SESSION_DAYS = 30
const PENDING_2FA_MINUTES = 10

export interface AuthUser {
  id: string
  email: string
  name: string
  role: string
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser
    sessionId: string
    storageLock: string | null // the private-storage key, locked with this session's token
  }
}

// storageKey: the user's unlocked private-storage key, if they use private storage.
export async function startSession(request: FastifyRequest, reply: FastifyReply, userId: string, pending2fa: boolean, storageKey?: KeyObject) {
  const token = randomToken()
  const lifetime = pending2fa ? PENDING_2FA_MINUTES * 60_000 : SESSION_DAYS * 86_400_000
  await db.session.create({
    data: {
      id: sha256(token),
      userId,
      pending2fa,
      storageKey: storageKey ? lockWithToken(storageKey, token) : null,
      userAgent: request.headers['user-agent']?.slice(0, 200),
      ip: request.ip,
      expiresAt: new Date(Date.now() + lifetime),
    },
  })
  reply.setCookie(COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'strict', // the browser never sends it on requests started by other sites (CSRF)
    maxAge: lifetime / 1000,
  })
}

export async function endSession(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[COOKIE]
  if (token) await db.session.deleteMany({ where: { id: sha256(token) } })
  reply.clearCookie(COOKIE, { path: '/' })
}

// Finds the session behind the cookie, or null. Expired sessions are deleted on sight.
export async function findSession(request: FastifyRequest) {
  const token = request.cookies[COOKIE]
  if (!token) return null
  const session = await db.session.findUnique({ where: { id: sha256(token) }, include: { user: true } })
  if (!session) return null
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } })
    return null
  }
  // Only write lastSeenAt every few minutes, not on every request.
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
  }
  return session
}

// preHandler for every route that needs a signed-in user.
export async function requireUser(request: FastifyRequest) {
  const session = await findSession(request)
  if (!session || session.pending2fa) throw new HttpError(401, 'Sign in to continue')
  const { id, email, name, role } = session.user
  request.user = { id, email, name, role }
  request.sessionId = session.id
  request.storageLock = session.storageKey
}

export async function requireAdmin(request: FastifyRequest) {
  await requireUser(request)
  if (request.user.role !== 'admin') throw new HttpError(403, 'Only admins can do this')
}

// Blocks state-changing requests that come from another website (defence in depth next to SameSite).
export function checkOrigin(request: FastifyRequest) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return
  const origin = request.headers.origin
  if (origin && origin !== new URL(config.PUBLIC_URL).origin) throw new HttpError(403, 'Cross-site request blocked')
}

// The signed-in user's private-storage key, or null if they don't use private storage.
// Only this request's cookie can unlock the copy stored with the session.
export async function storageKey(request: FastifyRequest): Promise<KeyObject | null> {
  const token = request.cookies[COOKIE]
  if (!request.storageLock || !token) return null
  return unlockWithToken(request.storageLock, token)
}

// Locks a key into the current session (used when private storage is turned on mid-session).
export async function setSessionStorageKey(request: FastifyRequest, key: KeyObject) {
  const token = request.cookies[COOKIE]
  if (token) await db.session.update({ where: { id: request.sessionId }, data: { storageKey: lockWithToken(key, token) } })
}

export const sessionToken = (request: FastifyRequest) => request.cookies[COOKIE]
