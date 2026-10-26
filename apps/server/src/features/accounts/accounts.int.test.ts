// Mail accounts: adding them (against the GreenMail test server), editing, sharing with other
// users and what each role may do, and Google sign-in (against a fake Google).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { db } from '../../db.ts'
import { decrypt, encrypt } from '../../lib/crypto.ts'
import { Browser, addAccount, greenMail, signedInUser, startApp, uniqueAddress } from '../../test/helpers.ts'
import { accessToken, forgetAccessToken } from './oauth.ts'

let app: Awaited<ReturnType<typeof startApp>>
beforeAll(async () => {
  app = await startApp()
})
afterAll(() => app.close())
afterEach(() => vi.unstubAllGlobals())

describe('adding an account', () => {
  it('checks the login works, then saves it with a colour and the password encrypted', async () => {
    const { browser } = await signedInUser(app)
    const { id, email } = await addAccount(browser)

    const [account] = await browser.json('GET', '/api/accounts')
    expect(account).toMatchObject({
      id,
      email,
      role: 'owner',
      protocol: 'imap',
      inHost: 'localhost',
      color: expect.stringMatching(/^#/),
    })
    const stored = await db.account.findUniqueOrThrow({ where: { id } })
    expect(stored.secret).not.toContain('any password')
    expect(decrypt(stored.secret)).toBe('any password')
  })

  it('refuses a server it cannot log in to, and the same account twice', async () => {
    const { browser } = await signedInUser(app)
    const unreachable = await browser.post('/api/accounts', { ...greenMail(uniqueAddress()), inPort: 1 })
    expect(unreachable.statusCode).toBe(400)
    expect(unreachable.json().error).toMatch(/^Could not connect: .*ECONNREFUSED/)

    const { email } = await addAccount(browser)
    const twice = await browser.post('/api/accounts', greenMail(email))
    expect(twice.statusCode).toBe(400)
    expect(twice.json().error).toMatch(/already added/)
  })

  it('works with POP3 too', async () => {
    const { browser } = await signedInUser(app)
    await addAccount(browser, uniqueAddress('pop'), 'pop3')
    expect((await browser.json('GET', '/api/accounts'))[0].protocol).toBe('pop3')
  })
})

describe('editing and removing an account', () => {
  it('renames, recolours and sets a signature; a new password is tested first', async () => {
    const { browser } = await signedInUser(app)
    const { id } = await addAccount(browser)
    await browser.json('PATCH', `/api/accounts/${id}`, { name: 'Work', color: '#123abc', signature: '<p>Cheers</p>' })
    expect((await browser.json('GET', '/api/accounts'))[0]).toMatchObject({
      name: 'Work',
      color: '#123abc',
      signature: '<p>Cheers</p>',
    })

    const badServer = await browser.patch(`/api/accounts/${id}`, { inPort: 1 })
    expect(badServer.statusCode).toBe(400)
    expect((await browser.patch(`/api/accounts/${id}`, { color: 'red' })).statusCode).toBe(400)
  })

  it('removes the account and Nexus’s copy of its mail', async () => {
    const { browser } = await signedInUser(app)
    const { id } = await addAccount(browser)
    const folder = await db.folder.create({ data: { accountId: id, path: 'INBOX', role: 'inbox' } })
    await db.message.create({
      data: {
        accountId: id,
        folderId: folder.id,
        fromName: 'A',
        fromEmail: 'a@x.test',
        to: [],
        cc: [],
        subject: 's',
        preview: '',
        date: new Date(),
        category: 'people',
        labels: [],
        attachments: [],
        raw: Buffer.from('x'),
      },
    })
    await browser.json('DELETE', `/api/accounts/${id}`)
    expect(await browser.json('GET', '/api/accounts')).toEqual([])
    expect(await db.message.count({ where: { accountId: id } })).toBe(0)
  })

  it('queues a sync on request', async () => {
    const { browser } = await signedInUser(app)
    const { id } = await addAccount(browser)
    expect(await browser.json('POST', `/api/accounts/${id}/sync`)).toEqual({ ok: true })
  })
})

describe('sharing an account', () => {
  // An owner with one account holding one message, plus a second user to share it with.
  async function sharedSetup(role: 'viewer' | 'editor') {
    const owner = await signedInUser(app, { name: 'Owner' })
    const member = await signedInUser(app, { name: 'Member' })
    const { id: accountId } = await addAccount(owner.browser)
    const folder = await db.folder.create({ data: { accountId, path: 'INBOX', role: 'inbox' } })
    const message = await db.message.create({
      data: {
        accountId,
        folderId: folder.id,
        fromName: 'A',
        fromEmail: 'a@x.test',
        to: [],
        cc: [],
        subject: 'Hello',
        preview: 'Hi',
        text: 'Hi',
        date: new Date(),
        category: 'people',
        labels: [],
        attachments: [],
        raw: Buffer.from('Subject: Hello\r\n\r\nHi\r\n'),
      },
    })
    await owner.browser.json('PUT', `/api/accounts/${accountId}/members`, { userId: member.user.id, role })
    return { owner, member, accountId, messageId: message.id }
  }

  it('shows a shared account to its member, without the server login details', async () => {
    const { member, accountId } = await sharedSetup('viewer')
    const [account] = await member.browser.json('GET', '/api/accounts')
    expect(account).toMatchObject({ id: accountId, role: 'viewer' })
    expect(account.inHost).toBeUndefined()
    expect(account.username).toBeUndefined()
  })

  it('lets a viewer read, but not change, send, share or delete', async () => {
    const { member, accountId, messageId } = await sharedSetup('viewer')
    const viewer = member.browser
    expect((await viewer.get(`/api/messages/${messageId}`)).statusCode).toBe(200)
    expect((await viewer.post(`/api/messages/${messageId}/move`, { to: 'archive' })).statusCode).toBe(403)
    expect((await viewer.patch(`/api/messages/${messageId}`, { starred: true })).statusCode).toBe(403)
    expect((await viewer.post('/api/send', { accountId, to: ['x@x.test'], text: 'x' })).statusCode).toBe(403)
    expect((await viewer.get(`/api/accounts/${accountId}/members`)).statusCode).toBe(403)
    expect(
      (await viewer.put(`/api/accounts/${accountId}/members`, { userId: member.user.id, role: 'editor' })).statusCode,
    ).toBe(403)
    expect((await viewer.delete(`/api/accounts/${accountId}`)).statusCode).toBe(403)
  })

  it('lets an editor change the signature, but not the account’s settings', async () => {
    const { member, accountId } = await sharedSetup('editor')
    expect((await member.browser.patch(`/api/accounts/${accountId}`, { signature: 'Team inbox' })).statusCode).toBe(200)
    expect((await member.browser.patch(`/api/accounts/${accountId}`, { name: 'Mine now' })).statusCode).toBe(403)
  })

  it('hides accounts from everyone else, as if they did not exist', async () => {
    const { accountId, messageId } = await sharedSetup('viewer')
    const stranger = await signedInUser(app)
    expect((await stranger.browser.get(`/api/messages/${messageId}`)).statusCode).toBe(404)
    expect((await stranger.browser.patch(`/api/accounts/${accountId}`, { name: 'x' })).statusCode).toBe(404)
    expect(await stranger.browser.json('GET', '/api/accounts')).toEqual([])
  })

  it('lists members and takes access away again', async () => {
    const { owner, member, accountId, messageId } = await sharedSetup('viewer')
    expect(await owner.browser.json('GET', `/api/accounts/${accountId}/members`)).toEqual([
      { userId: member.user.id, name: 'Member', email: member.user.email, role: 'viewer' },
    ])
    expect(
      (await owner.browser.put(`/api/accounts/${accountId}/members`, { userId: owner.user.id, role: 'viewer' }))
        .statusCode,
    ).toBe(400)

    await owner.browser.json('DELETE', `/api/accounts/${accountId}/members/${member.user.id}`)
    expect((await member.browser.get(`/api/messages/${messageId}`)).statusCode).toBe(404)
  })

  it('lets anyone signed in see the user directory for sharing', async () => {
    const { browser, user } = await signedInUser(app, { name: 'Zed Directory' })
    const directory = await browser.json<{ id: string; email: string }[]>('GET', '/api/users/directory')
    expect(directory.find((u) => u.id === user.id)).toEqual({ id: user.id, name: 'Zed Directory', email: user.email })
  })
})

describe('Google sign-in', () => {
  // A fake Google token endpoint. The ID token carries the signed-in email, as Google's does.
  function fakeGoogle(response: Record<string, unknown>) {
    const idToken = (email: string) =>
      `x.${Buffer.from(JSON.stringify({ email, name: 'Gee Mail' })).toString('base64url')}.x`
    const calls: URLSearchParams[] = []
    vi.stubGlobal('fetch', async (url: string, init: { body: URLSearchParams }) => {
      expect(url).toBe('https://oauth2.googleapis.com/token')
      calls.push(new URLSearchParams(init.body))
      const body = {
        access_token: 'access-1',
        expires_in: 3600,
        ...response,
        ...(response.email ? { id_token: idToken(String(response.email)) } : {}),
      }
      return new Response(JSON.stringify(body), { status: 200 })
    })
    return calls
  }

  // Starts sign-in in the app, then comes back from "Google" with a code, like the browser redirect does.
  async function signInWithGoogle(browser: Browser, response: Record<string, unknown>) {
    const { url } = await browser.json('GET', '/api/oauth/google/start')
    const state = new URL(url).searchParams.get('state')
    fakeGoogle(response)
    // The callback arrives without our cookie (it's a cross-site redirect), so a fresh browser is used.
    return new Browser(app).get(`/api/oauth/google/callback?code=the-code&state=${state}`)
  }

  it('sends people to Google with our client id, the callback address and a random state', async () => {
    const { browser } = await signedInUser(app)
    const { url } = await browser.json('GET', '/api/oauth/google/start')
    const params = new URL(url).searchParams
    expect(url).toMatch(/^https:\/\/accounts\.google\.com\//)
    expect(params.get('client_id')).toBe('test-client-id')
    expect(params.get('redirect_uri')).toBe('http://localhost:8080/api/oauth/google/callback')
    expect(params.get('scope')).toContain('https://mail.google.com/')
    expect(params.get('state')).toMatch(/^[\w-]{20,}$/)
  })

  it('adds a Gmail account, and signing in again updates it instead of adding a second one', async () => {
    const { browser, user } = await signedInUser(app)
    const email = uniqueAddress('gmail')
    const first = await signInWithGoogle(browser, { email, refresh_token: 'refresh-1' })
    expect(first.statusCode).toBe(302)
    expect(first.headers.location).toBe('/settings/accounts?added=1')

    const [account] = await db.account.findMany({ where: { ownerId: user.id } })
    expect(account).toMatchObject({ email, auth: 'oauth-google', inHost: 'imap.gmail.com', smtpHost: 'smtp.gmail.com' })
    expect(decrypt(account.secret)).toBe('refresh-1')

    await db.account.update({ where: { id: account.id }, data: { syncError: 'Token expired' } })
    await signInWithGoogle(browser, { email, refresh_token: 'refresh-2' })
    const accounts = await db.account.findMany({ where: { ownerId: user.id } })
    expect(accounts).toHaveLength(1)
    expect(decrypt(accounts[0].secret)).toBe('refresh-2')
    expect(accounts[0].syncError).toBeNull()
  })

  it('rejects a callback with an unknown or reused state', async () => {
    const response = await new Browser(app).get('/api/oauth/google/callback?code=x&state=made-up')
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toMatch(/expired/)
  })

  it('passes on a refusal from Google to the settings page', async () => {
    const response = await new Browser(app).get('/api/oauth/google/callback?error=access_denied&state=x')
    expect(response.headers.location).toBe('/settings/accounts?error=access_denied')
  })

  it('explains when Google gives no refresh token', async () => {
    const { browser } = await signedInUser(app)
    const response = await signInWithGoogle(browser, { email: uniqueAddress() })
    expect(response.statusCode).toBe(502)
    expect(response.json().error).toMatch(/did not return a refresh token/)
  })

  it('explains when a provider is not set up on this server', async () => {
    const { browser } = await signedInUser(app)
    const response = await browser.get('/api/oauth/microsoft/start')
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toMatch(/not set up/)
    expect((await browser.get('/api/oauth/yahoo/start')).statusCode).toBe(404)
  })
})

describe('OAuth access tokens', () => {
  it('reuses a token until it expires, and keeps a rotated refresh token', async () => {
    const { user } = await signedInUser(app)
    const account = await db.account.create({
      data: {
        ownerId: user.id,
        email: uniqueAddress(),
        name: 'G',
        color: '#000000',
        protocol: 'imap',
        auth: 'oauth-google',
        inHost: 'imap.gmail.com',
        inPort: 993,
        inTls: true,
        smtpHost: 'smtp.gmail.com',
        smtpPort: 465,
        smtpTls: true,
        username: 'g',
        secret: encrypt('refresh-old'),
      },
    })
    let requests = 0
    vi.stubGlobal('fetch', async (_url: string, init: { body: URLSearchParams }) => {
      requests++
      expect(new URLSearchParams(init.body).get('grant_type')).toBe('refresh_token')
      return new Response(
        JSON.stringify({ access_token: `access-${requests}`, expires_in: 3600, refresh_token: 'refresh-new' }),
      )
    })

    expect(await accessToken(account)).toBe('access-1')
    expect(await accessToken(account)).toBe('access-1') // from the cache, no second request
    expect(requests).toBe(1)
    expect(decrypt((await db.account.findUniqueOrThrow({ where: { id: account.id } })).secret)).toBe('refresh-new')

    forgetAccessToken(account.id)
    expect(await accessToken(account)).toBe('access-2')
  })

  it('reports a failed refresh as a sign-in problem', async () => {
    vi.stubGlobal('fetch', async () => new Response('invalid_grant', { status: 400 }))
    const account = { id: 'no-such-account', auth: 'oauth-google', secret: encrypt('revoked') }
    await expect(accessToken(account)).rejects.toThrow(/google sign-in failed: invalid_grant/)
  })
})
