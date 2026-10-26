// Signing up, signing in (with and without two-factor), passwords, sessions and request security.
import { authenticator } from 'otplib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { config } from '../../config.ts'
import { db } from '../../db.ts'
import { Browser, PASSWORD, signedInUser, startApp, uniqueAddress } from '../../test/helpers.ts'

let app: Awaited<ReturnType<typeof startApp>>

beforeAll(async () => {
  // These tests need an empty server, as on the very first start.
  await db.user.deleteMany()
  app = await startApp()
})
afterAll(async () => {
  config.ALLOW_SIGNUP = false
  await app.close()
})

describe('sign-up', () => {
  it('makes the first person the admin, then closes sign-up', async () => {
    const first = new Browser(app)
    expect((await first.json('GET', '/api/auth/status')).needsSetup).toBe(true)

    await first.json('POST', '/api/auth/signup', { name: 'Ada', email: 'Ada@Example.test', password: PASSWORD })
    const me = await first.json('GET', '/api/auth/me')
    expect(me).toMatchObject({ name: 'Ada', email: 'ada@example.test', role: 'admin', totpEnabled: false })

    const second = await new Browser(app).post('/api/auth/signup', {
      name: 'Bo',
      email: uniqueAddress(),
      password: PASSWORD,
    })
    expect(second.statusCode).toBe(403)
  })

  it('lets anyone join as a normal user when ALLOW_SIGNUP is on', async () => {
    config.ALLOW_SIGNUP = true
    const browser = new Browser(app)
    await browser.json('POST', '/api/auth/signup', { name: 'Bo', email: uniqueAddress(), password: PASSWORD })
    expect((await browser.json('GET', '/api/auth/me')).role).toBe('user')
    config.ALLOW_SIGNUP = false
  })

  it('refuses a short password or a taken email, saying why', async () => {
    config.ALLOW_SIGNUP = true
    const short = await new Browser(app).post('/api/auth/signup', {
      name: 'C',
      email: uniqueAddress(),
      password: 'short',
    })
    expect(short.statusCode).toBe(400)
    expect(short.json().error).toMatch(/12 characters/)

    const taken = await new Browser(app).post('/api/auth/signup', {
      name: 'C',
      email: 'ada@example.test',
      password: PASSWORD,
    })
    expect(taken.statusCode).toBe(400)
    expect(taken.json().error).toMatch(/already registered/)
    config.ALLOW_SIGNUP = false
  })
})

describe('sign-in', () => {
  it('needs the right email and password, and gives the same answer for an unknown email', async () => {
    const { user } = await signedInUser(app)
    const wrongPassword = await new Browser(app).post('/api/auth/login', {
      email: user.email,
      password: 'not the password',
    })
    const unknownEmail = await new Browser(app).post('/api/auth/login', {
      email: 'nobody@nexus.test',
      password: PASSWORD,
    })
    expect([wrongPassword.statusCode, unknownEmail.statusCode]).toEqual([401, 401])
    expect(wrongPassword.json().error).toBe(unknownEmail.json().error)
  })

  it('keeps everything behind sign-in, and signing out ends the session', async () => {
    expect((await new Browser(app).get('/api/auth/me')).statusCode).toBe(401)
    expect((await new Browser(app).get('/api/messages')).statusCode).toBe(401)

    const { browser } = await signedInUser(app)
    const cookie = browser.cookie
    expect((await browser.get('/api/auth/me')).statusCode).toBe(200)
    await browser.json('POST', '/api/auth/logout')
    // Even the old cookie no longer works: the session is gone from the database.
    browser.cookie = cookie
    expect((await browser.get('/api/auth/me')).statusCode).toBe(401)
  })

  it('stores only a hash of the session token', async () => {
    const { user, browser } = await signedInUser(app)
    const token = browser.cookie.split('=')[1]
    const sessions = await db.session.findMany({ where: { userId: user.id } })
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).not.toContain(token)
  })
})

describe('two-factor sign-in', () => {
  it('turns on with an authenticator code, then asks for a code at every sign-in', async () => {
    const { user, browser } = await signedInUser(app)
    const setup = await browser.json('POST', '/api/auth/2fa/setup')
    expect(setup.qrCode).toMatch(/^data:image\/png;base64,/)
    expect(setup.otpauthUrl).toContain('Nexus')

    const wrong = await browser.post('/api/auth/2fa/enable', { secret: setup.secret, code: '000000' })
    expect(wrong.statusCode).toBe(400)
    const { recoveryCodes } = await browser.json('POST', '/api/auth/2fa/enable', {
      secret: setup.secret,
      code: authenticator.generate(setup.secret),
    })
    expect(recoveryCodes).toHaveLength(10)

    // Password alone gives a half-signed-in session that can't read anything.
    const phone = new Browser(app)
    expect(
      (await phone.json('POST', '/api/auth/login', { email: user.email, password: PASSWORD })).twoFactorRequired,
    ).toBe(true)
    expect((await phone.get('/api/auth/me')).statusCode).toBe(401)
    expect((await phone.post('/api/auth/2fa', { code: '000000' })).statusCode).toBe(401)

    await phone.json('POST', '/api/auth/2fa', { code: authenticator.generate(setup.secret) })
    expect((await phone.json('GET', '/api/auth/me')).totpEnabled).toBe(true)
  })

  it('accepts each recovery code once, typed with or without the dash', async () => {
    const { user, browser } = await signedInUser(app)
    const { secret } = await browser.json('POST', '/api/auth/2fa/setup')
    const { recoveryCodes } = await browser.json('POST', '/api/auth/2fa/enable', {
      secret,
      code: authenticator.generate(secret),
    })

    const signInWithRecovery = async (code: string) => {
      const phone = new Browser(app)
      await phone.json('POST', '/api/auth/login', { email: user.email, password: PASSWORD })
      return (await phone.post('/api/auth/2fa', { recoveryCode: code })).statusCode
    }
    expect(await signInWithRecovery(recoveryCodes[0].replace('-', '').toUpperCase())).toBe(200)
    expect(await signInWithRecovery(recoveryCodes[0])).toBe(401) // already used
    expect((await browser.json('GET', '/api/auth/me')).recoveryCodesLeft).toBe(9)

    // New codes replace the old ones.
    const fresh = await browser.json('POST', '/api/auth/2fa/recovery-codes', { password: PASSWORD })
    expect(await signInWithRecovery(recoveryCodes[1])).toBe(401)
    expect(await signInWithRecovery(fresh.recoveryCodes[0])).toBe(200)
  })

  it('turns off only with the password', async () => {
    const { browser } = await signedInUser(app)
    const { secret } = await browser.json('POST', '/api/auth/2fa/setup')
    await browser.json('POST', '/api/auth/2fa/enable', { secret, code: authenticator.generate(secret) })
    expect((await browser.post('/api/auth/2fa/disable', { password: 'wrong' })).statusCode).toBe(400)
    await browser.json('POST', '/api/auth/2fa/disable', { password: PASSWORD })
    expect((await browser.json('GET', '/api/auth/me')).totpEnabled).toBe(false)
  })
})

describe('password and sessions', () => {
  it('changes the password with the current one, and signs out every other device', async () => {
    const { user, browser } = await signedInUser(app)
    const phone = new Browser(app)
    await phone.json('POST', '/api/auth/login', { email: user.email, password: PASSWORD })

    expect(
      (await browser.post('/api/auth/password', { current: 'wrong', next: 'a brand new password' })).statusCode,
    ).toBe(400)
    await browser.json('POST', '/api/auth/password', { current: PASSWORD, next: 'a brand new password' })

    expect((await browser.get('/api/auth/me')).statusCode).toBe(200)
    expect((await phone.get('/api/auth/me')).statusCode).toBe(401)
    expect(
      (await new Browser(app).post('/api/auth/login', { email: user.email, password: 'a brand new password' }))
        .statusCode,
    ).toBe(200)
  })

  it('lists your devices and signs one out', async () => {
    const { user, browser } = await signedInUser(app)
    const phone = new Browser(app)
    await phone.json('POST', '/api/auth/login', { email: user.email, password: PASSWORD })

    const sessions = await browser.json<{ id: string; current: boolean }[]>('GET', '/api/auth/sessions')
    expect(sessions).toHaveLength(2)
    const other = sessions.find((s) => !s.current)!
    await browser.json('DELETE', `/api/auth/sessions/${other.id}`)
    expect((await phone.get('/api/auth/me')).statusCode).toBe(401)
  })

  it('saves theme and layout preferences, and rejects unknown values', async () => {
    const { browser } = await signedInUser(app)
    expect((await browser.json('GET', '/api/auth/me')).preferences).toMatchObject({
      theme: 'system',
      layout: 'three-pane',
    })
    await browser.json('PUT', '/api/auth/me/preferences', { theme: 'dark', layout: 'list' })
    expect((await browser.json('GET', '/api/auth/me')).preferences).toMatchObject({ theme: 'dark', layout: 'list' })
    expect((await browser.put('/api/auth/me/preferences', { theme: 'purple' })).statusCode).toBe(400)
  })
})

describe('request security', () => {
  it('blocks changes sent from another website', async () => {
    const { browser } = await signedInUser(app)
    const evil = await browser.request('POST', '/api/auth/logout', {}, { origin: 'https://evil.example' })
    expect(evil.statusCode).toBe(403)
    const ours = await browser.request('POST', '/api/auth/logout', {}, { origin: config.PUBLIC_URL })
    expect(ours.statusCode).toBe(200)
  })

  it('sends security headers and an httpOnly, SameSite=Strict cookie', async () => {
    const browser = new Browser(app)
    const response = await browser.post('/api/auth/login', { email: 'nobody@nexus.test', password: 'x' })
    expect(response.headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'SAMEORIGIN',
      'referrer-policy': 'no-referrer',
    })

    const { user } = await signedInUser(app)
    const login = await new Browser(app).post('/api/auth/login', { email: user.email, password: PASSWORD })
    const cookie = String(login.headers['set-cookie'])
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Strict/i)
  })

  it('answers unknown API paths with a JSON 404', async () => {
    const response = await new Browser(app).get('/api/does-not-exist')
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'Not found' })
  })

  it('slows down password guessing: 10 sign-in attempts a minute', async () => {
    const attacker = new Browser(app)
    const statuses: number[] = []
    for (let i = 0; i < 11; i++)
      statuses.push(
        (await attacker.post('/api/auth/login', { email: 'nobody@nexus.test', password: 'guess' })).statusCode,
      )
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true)
    expect(statuses[10]).toBe(429)
    // Someone else, from another address, can still sign in.
    expect(
      (await new Browser(app).post('/api/auth/login', { email: 'nobody@nexus.test', password: 'guess' })).statusCode,
    ).toBe(401)
  })
})
