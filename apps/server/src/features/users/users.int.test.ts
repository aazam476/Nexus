// Admins managing the people on this server.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../db.ts'
import { Browser, PASSWORD, signedInUser, startApp, uniqueAddress } from '../../test/helpers.ts'

let app: Awaited<ReturnType<typeof startApp>>
beforeAll(async () => {
  app = await startApp()
})
afterAll(() => app.close())

describe('user management', () => {
  it('lets an admin add a user, who can then sign in', async () => {
    const admin = await signedInUser(app, { role: 'admin' })
    const email = uniqueAddress('new')
    const { id } = await admin.browser.json('POST', '/api/users', { name: 'New Person', email, password: PASSWORD })
    const listed = (await admin.browser.json<{ id: string; role: string }[]>('GET', '/api/users')).find(
      (u) => u.id === id,
    )
    expect(listed).toMatchObject({ role: 'user' })
    expect((await new Browser(app).post('/api/auth/login', { email, password: PASSWORD })).statusCode).toBe(200)

    expect((await admin.browser.post('/api/users', { name: 'Again', email, password: PASSWORD })).json().error).toMatch(
      /already registered/,
    )
    expect(
      (await admin.browser.post('/api/users', { name: 'Short', email: uniqueAddress(), password: 'short' })).statusCode,
    ).toBe(400)
  })

  it('promotes, demotes and removes users, but never the admin themself', async () => {
    const admin = await signedInUser(app, { role: 'admin' })
    const other = await signedInUser(app)
    await admin.browser.json('PATCH', `/api/users/${other.user.id}`, { role: 'admin' })
    expect((await other.browser.json('GET', '/api/auth/me')).role).toBe('admin')

    expect((await admin.browser.patch(`/api/users/${admin.user.id}`, { role: 'user' })).json().error).toMatch(
      /own admin role/,
    )
    expect((await admin.browser.delete(`/api/users/${admin.user.id}`)).json().error).toMatch(/cannot delete yourself/)

    await admin.browser.json('DELETE', `/api/users/${other.user.id}`)
    expect((await other.browser.get('/api/auth/me')).statusCode).toBe(401)
  })

  it('resets a password, turns off two-factor sign-in, and shows an overview', async () => {
    const admin = await signedInUser(app, { role: 'admin' })
    const other = await signedInUser(app)
    await admin.browser.json('POST', `/api/users/${other.user.id}/password`, { password: 'a brand new password' })
    expect((await other.browser.get('/api/auth/me')).statusCode).toBe(401)
    const login = (password: string) => new Browser(app).post('/api/auth/login', { email: other.user.email, password })
    expect((await login(PASSWORD)).statusCode).toBe(401)
    expect((await login('a brand new password')).statusCode).toBe(200)
    expect((await admin.browser.post(`/api/users/${other.user.id}/password`, { password: 'short' })).statusCode).toBe(
      400,
    )

    await db.user.update({ where: { id: other.user.id }, data: { totpEnabled: true, recoveryCodes: ['x'] } })
    await admin.browser.json('DELETE', `/api/users/${other.user.id}/2fa`)
    expect((await login('a brand new password')).json().twoFactorRequired).toBe(false)

    const overview = await admin.browser.json<{ users: number; failing: unknown[] }>('GET', '/api/users/overview')
    expect(overview.users).toBeGreaterThanOrEqual(2)
    expect(Array.isArray(overview.failing)).toBe(true)
  })

  it('is admin-only', async () => {
    const { browser, user } = await signedInUser(app)
    expect((await browser.get('/api/users')).statusCode).toBe(403)
    expect(
      (await browser.post('/api/users', { name: 'x', email: uniqueAddress(), password: PASSWORD })).statusCode,
    ).toBe(403)
    expect((await browser.patch(`/api/users/${user.id}`, { role: 'admin' })).statusCode).toBe(403)
    expect((await browser.post(`/api/users/${user.id}/password`, { password: PASSWORD })).statusCode).toBe(403)
    expect((await browser.get('/api/users/overview')).statusCode).toBe(403)
  })
})
