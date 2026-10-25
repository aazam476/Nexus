// The HTTP server itself: serving the built web app with its security policy, hiding internal
// errors from users, and expiring old sessions.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { config } from './config.ts'
import { db } from './db.ts'
import { Browser, signedInUser, startApp } from './test/helpers.ts'

let app: Awaited<ReturnType<typeof startApp>>
const webDist = mkdtempSync(join(tmpdir(), 'nexus-web-'))
const originalWebDist = config.WEB_DIST

beforeAll(async () => {
  // A stand-in for the built web app (apps/web/dist).
  writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>Nexus</title>')
  writeFileSync(join(webDist, 'app.js'), 'console.log("hi")')
  config.WEB_DIST = webDist
  app = await startApp()
  // A route that fails the way a bug would, to see what the user gets back.
  app.get('/api/test/crash', async () => {
    throw new Error('database password is hunter2')
  })
})
afterAll(async () => {
  config.WEB_DIST = originalWebDist
  rmSync(webDist, { recursive: true, force: true })
  await app.close()
})

describe('the web app', () => {
  it('serves the app for every page, so links like /mail/inbox work when opened directly', async () => {
    for (const path of ['/', '/mail/inbox', '/settings/accounts']) {
      const page = await new Browser(app).get(path)
      expect(page.statusCode).toBe(200)
      expect(page.body).toContain('<title>Nexus</title>')
    }
    expect((await new Browser(app).get('/app.js')).body).toBe('console.log("hi")')
  })

  it('locks pages down with a Content-Security-Policy: no inline or remote scripts, no framing by other sites', async () => {
    const csp = String((await new Browser(app).get('/mail/inbox')).headers['content-security-policy'])
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'self'")
    expect(csp).not.toContain('unsafe-eval')
  })

  it('keeps answering API typos with a JSON 404, not the app', async () => {
    const response = await new Browser(app).get('/api/nope')
    expect([response.statusCode, response.json()]).toEqual([404, { error: 'Not found' }])
  })
})

describe('errors', () => {
  it('never shows internal error details to users', async () => {
    const response = await new Browser(app).get('/api/test/crash')
    expect(response.statusCode).toBe(500)
    expect(response.body).not.toContain('hunter2')
    expect(response.json().error).toMatch(/server log/)
  })

  it('reports a malformed request body as a 400', async () => {
    const response = await new Browser(app).request('POST', '/api/auth/login', '{not json', { 'content-type': 'application/json' })
    expect(response.statusCode).toBe(400)
  })
})

describe('sessions', () => {
  it('ends a session once it expires', async () => {
    const { browser, user } = await signedInUser(app)
    await db.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await browser.get('/api/auth/me')).statusCode).toBe(401)
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0)
  })

  it('notes when a device was last used, at most every few minutes', async () => {
    const { browser, user } = await signedInUser(app)
    const old = new Date(Date.now() - 10 * 60_000)
    await db.session.updateMany({ where: { userId: user.id }, data: { lastSeenAt: old } })
    await browser.get('/api/auth/me')
    const [session] = await db.session.findMany({ where: { userId: user.id } })
    expect(session.lastSeenAt.getTime()).toBeGreaterThan(old.getTime())
  })
})
