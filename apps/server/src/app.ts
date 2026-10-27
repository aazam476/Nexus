// Builds the HTTP server: security headers, error handling, every API route, and the web app.
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { config } from './config.ts'
import { accountRoutes } from './features/accounts/routes.ts'
import { authRoutes } from './features/auth/routes.ts'
import { passkeyRoutes } from './features/auth/passkeys.ts'
import { contactRoutes } from './features/contacts/routes.ts'
import { encryptionRoutes } from './features/encryption/routes.ts'
import { feedRoutes } from './features/feeds/routes.ts'
import { importExportRoutes } from './features/importexport/routes.ts'
import { mailRoutes } from './features/mail/routes.ts'
import { pluginRoutes } from './features/plugins/routes.ts'
import { sendRoutes } from './features/send/routes.ts'
import { settingsRoutes } from './features/settings/routes.ts'
import { userRoutes } from './features/users/routes.ts'
import { HttpError } from './lib/http.ts'
import { checkOrigin } from './lib/session.ts'

// The web app's Content Security Policy. Email HTML is shown in sandboxed srcdoc iframes, which
// inherit this policy: scripts can never run, and remote images load only after "Load images".
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ')

export async function buildApp() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    // Only believe X-Forwarded-For from a reverse proxy on this machine or the local network;
    // trusting it from anyone would let attackers fake their IP and dodge the login rate limit.
    trustProxy: 'loopback,linklocal,uniquelocal',
    bodyLimit: 2 * 1024 * 1024,
  })

  await app.register(cookie)
  await app.register(rateLimit, { global: false })
  // Uploads are held in memory while they are imported, so cap them.
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 10 } })

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-content-type-options', 'nosniff')
    reply.header('referrer-policy', 'no-referrer')
    // SAMEORIGIN, not DENY: Nexus itself shows attachment previews (PDF, text) in frames. Other sites still can't.
    reply.header('x-frame-options', 'SAMEORIGIN')
    if (request.url.startsWith('/api/')) checkOrigin(request)
  })

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    if (error instanceof HttpError) return reply.status(error.status).send({ error: error.message })
    if (error.statusCode && error.statusCode < 500) return reply.status(error.statusCode).send({ error: error.message })
    request.log.error(error)
    return reply.status(500).send({ error: 'Something went wrong on the server. The details are in the server log.' })
  })

  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(passkeyRoutes, { prefix: '/api/auth' })
  await app.register(userRoutes, { prefix: '/api/users' })
  for (const routes of [
    accountRoutes,
    mailRoutes,
    sendRoutes,
    contactRoutes,
    settingsRoutes,
    encryptionRoutes,
    pluginRoutes,
    importExportRoutes,
    feedRoutes,
  ]) {
    await app.register(routes, { prefix: '/api' })
  }

  // The built web app. Any non-API path gets index.html so the React router can handle it.
  const webRoot = resolve(config.WEB_DIST)
  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot, wildcard: false })
    app.addHook('onSend', async (request, reply) => {
      if (!request.url.startsWith('/api/')) reply.header('content-security-policy', csp)
    })
  }
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/') || !existsSync(webRoot)) return reply.status(404).send({ error: 'Not found' })
    return reply.sendFile('index.html')
  })

  return app
}
