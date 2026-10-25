// Tests that need the real database, Redis and the GreenMail test mail server:
//   docker compose -f docker-compose.dev.yml up -d
// They are skipped when those aren't running, so `npm test` still works without Docker.
import { existsSync } from 'node:fs'
import { connect } from 'node:net'
import { resolve } from 'node:path'
import type { Prisma } from '@prisma/client'
import nodemailer from 'nodemailer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const envFile = resolve(import.meta.dirname, '../../../.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const reachable = (port: number) =>
  new Promise<boolean>((done) => {
    const socket = connect(port, 'localhost')
    socket.once('connect', () => { socket.end(); done(true) })
    socket.once('error', () => done(false))
  })
const servicesUp = !!process.env.DATABASE_URL && (await reachable(5432)) && (await reachable(6379)) && (await reachable(3025))

// Loaded only when the services are up: importing config without them would stop the process.
const load = async () => {
  const [{ db }, crypto, { buildApp }, { syncAccount }, { withImap }, { sendScheduled, failInterruptedSends }] = await Promise.all([
    import('./db.ts'),
    import('./lib/crypto.ts'),
    import('./app.ts'),
    import('./features/mail/sync.ts'),
    import('./features/accounts/connect.ts'),
    import('./features/send/send.ts'),
  ])
  crypto.setEncryptionSecret(process.env.APP_SECRET!)
  return { db, crypto, buildApp, syncAccount, withImap, sendScheduled, failInterruptedSends }
}

const unique = () => Math.random().toString(36).slice(2, 10)

// A mail account for tests. By default it points at port 1, so anything that tries to connect fails.
const makeAccount = (env: Awaited<ReturnType<typeof load>>, ownerId: string, overrides: Partial<Prisma.AccountUncheckedCreateInput> = {}) =>
  env.db.account.create({
    data: {
      ownerId, email: `a-${unique()}@test.local`, name: 'Test', color: '#000000', protocol: 'imap', auth: 'password',
      inHost: 'localhost', inPort: 1, inTls: true, smtpHost: 'localhost', smtpPort: 1, smtpTls: true, username: 'x', secret: env.crypto.encrypt('x'),
      ...overrides,
    },
  })

describe.skipIf(!servicesUp)('access control', () => {
  let env: Awaited<ReturnType<typeof load>>
  let app: Awaited<ReturnType<Awaited<ReturnType<typeof load>>['buildApp']>>
  const ids = { owner: '', viewer: '', account: '', message: '' }
  let viewerCookie = ''

  beforeAll(async () => {
    env = await load()
    app = await env.buildApp()
    const { db, crypto } = env
    const password = 'test password 123'
    const owner = await db.user.create({ data: { name: 'Owner', email: `owner-${unique()}@test.local`, passwordHash: await crypto.hashPassword(password) } })
    const viewer = await db.user.create({ data: { name: 'Viewer', email: `viewer-${unique()}@test.local`, passwordHash: await crypto.hashPassword(password) } })
    const account = await makeAccount(env, owner.id, { email: 'shared@test.local' })
    const folder = await db.folder.create({ data: { accountId: account.id, path: 'INBOX', role: 'inbox' } })
    const message = await db.message.create({
      data: {
        accountId: account.id, folderId: folder.id, fromName: 'A', fromEmail: 'a@test.local', to: [], cc: [], subject: 'Hello', preview: 'Hi',
        text: 'Hi', date: new Date(), category: 'people', labels: [], attachments: [], raw: Buffer.from('Subject: Hello\r\n\r\nHi\r\n'),
      },
    })
    await db.accountMember.create({ data: { accountId: account.id, userId: viewer.id, role: 'viewer' } })
    Object.assign(ids, { owner: owner.id, viewer: viewer.id, account: account.id, message: message.id })

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: viewer.email, password } })
    viewerCookie = String(login.headers['set-cookie']).split(';')[0]
  })

  afterAll(async () => {
    await env?.db.user.deleteMany({ where: { id: { in: [ids.owner, ids.viewer] } } }) // accounts and mail cascade
    await app?.close()
  })

  const asViewer = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => app.inject({ method, url, payload, headers: { cookie: viewerCookie } })

  it('lets a viewer read', async () => {
    expect((await asViewer('GET', `/api/messages/${ids.message}`)).statusCode).toBe(200)
  })

  it('stops a viewer from changing, sending or sharing', async () => {
    expect((await asViewer('POST', `/api/messages/${ids.message}/move`, { to: 'archive' })).statusCode).toBe(403)
    expect((await asViewer('POST', '/api/send', { accountId: ids.account, to: ['x@test.local'], text: 'x' })).statusCode).toBe(403)
    expect((await asViewer('GET', `/api/accounts/${ids.account}/members`)).statusCode).toBe(403)
    expect((await asViewer('PUT', `/api/accounts/${ids.account}/members`, { userId: ids.viewer, role: 'editor' })).statusCode).toBe(403)
  })

  it('hides other accounts entirely', async () => {
    expect((await app.inject({ method: 'GET', url: `/api/messages/${ids.message}` })).statusCode).toBe(401)
    expect((await asViewer('GET', '/api/messages/not-a-real-id')).statusCode).toBe(404)
  })
})

describe.skipIf(!servicesUp)('IMAP sync', () => {
  let env: Awaited<ReturnType<typeof load>>
  let userId = ''
  let accountId = ''
  const address = `sync-${unique()}@nexus.test`

  beforeAll(async () => {
    env = await load()
    const { db, crypto } = env
    const smtp = nodemailer.createTransport({ host: 'localhost', port: 3025, secure: false, ignoreTLS: true })
    for (const n of [1, 2, 3]) await smtp.sendMail({ from: 'Tester <t@test.local>', to: address, subject: `Message ${n}`, text: `Body ${n}` })
    smtp.close()

    const user = await db.user.create({ data: { name: 'Sync', email: `sync-${unique()}@test.local`, passwordHash: 'x' } })
    const account = await makeAccount(env, user.id, { email: address, inPort: 3993, smtpPort: 3465, username: address })
    userId = user.id
    accountId = account.id
  })

  afterAll(async () => {
    await env?.db.user.deleteMany({ where: { id: userId } })
  })

  const inbox = () => env.db.message.findMany({ where: { accountId, folder: { role: 'inbox' } }, orderBy: { subject: 'asc' } })

  it('downloads new mail, then mirrors read state and deletions made in other apps', async () => {
    await env.syncAccount(accountId)
    const first = await inbox()
    expect(first.map((m) => m.subject)).toEqual(['Message 1', 'Message 2', 'Message 3'])
    expect(first.every((m) => m.unread)).toBe(true)

    // Another mail app marks message 1 read and deletes message 2.
    const account = await env.db.account.findUniqueOrThrow({ where: { id: accountId } })
    await env.withImap(account, async (client) => {
      const lock = await client.getMailboxLock('INBOX')
      try {
        await client.messageFlagsAdd(String(first[0].uid), ['\\Seen'], { uid: true })
        await client.messageDelete(String(first[1].uid), { uid: true })
      } finally {
        lock.release()
      }
    })

    await env.syncAccount(accountId)
    const after = await inbox()
    expect(after.map((m) => [m.subject, m.unread])).toEqual([['Message 1', false], ['Message 3', true]])
  })
})

// A user with one account and one message, signed in through the real login route.
async function seedUser(env: Awaited<ReturnType<typeof load>>, app: Awaited<ReturnType<Awaited<ReturnType<typeof load>>['buildApp']>>, password: string) {
  const { db, crypto } = env
  const user = await db.user.create({ data: { name: 'U', email: `u-${unique()}@test.local`, passwordHash: await crypto.hashPassword(password) } })
  const account = await makeAccount(env, user.id)
  const folder = await db.folder.create({ data: { accountId: account.id, path: 'INBOX', role: 'inbox' } })
  const message = await db.message.create({
    data: {
      accountId: account.id, folderId: folder.id, fromName: 'A', fromEmail: 'a@test.local', to: [], cc: [], subject: 'Diary', preview: 'Secret preview',
      text: 'Dear diary', html: null, date: new Date(), category: 'people', labels: [], attachments: [], raw: Buffer.from('Subject: Diary\r\n\r\nDear diary\r\n'),
    },
  })
  const signIn = async (pw: string) => String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: user.email, password: pw } })).headers['set-cookie']).split(';')[0]
  return { user, account, message, signIn }
}

describe.skipIf(!servicesUp)('private storage', () => {
  let env: Awaited<ReturnType<typeof load>>
  let app: Awaited<ReturnType<Awaited<ReturnType<typeof load>>['buildApp']>>
  let userId = ''

  beforeAll(async () => {
    env = await load()
    app = await env.buildApp()
  })
  afterAll(async () => {
    await env?.db.user.deleteMany({ where: { id: userId } })
    await app?.close()
  })

  it('seals stored mail, opens it after sign-in and a password change, and unseals when turned off', async () => {
    const { user, message, signIn } = await seedUser(env, app, 'first password 1')
    userId = user.id
    const read = (cookie: string) => app.inject({ method: 'GET', url: `/api/messages/${message.id}`, headers: { cookie } })
    const post = (cookie: string, url: string, payload: object) => app.inject({ method: 'POST', url, payload, headers: { cookie } })

    const phone = await signIn('first password 1')
    const laptop = await signIn('first password 1')
    expect((await post(laptop, '/api/auth/private-storage', { enabled: true, password: 'first password 1' })).statusCode).toBe(200)

    const stored = await env.db.message.findUniqueOrThrow({ where: { id: message.id } })
    expect(stored.sealedBody).not.toBeNull()
    expect([stored.text, stored.html, stored.preview, stored.raw.length]).toEqual([null, null, '', 0])

    expect((await read(laptop)).json().text).toBe('Dear diary')
    expect((await read(phone)).statusCode).toBe(401) // other devices are signed out, so they can sign in and get the key

    expect((await post(laptop, '/api/auth/password', { current: 'first password 1', next: 'second password 2' })).statusCode).toBe(200)
    const again = await signIn('second password 2')
    expect((await read(again)).json().text).toBe('Dear diary')

    expect((await post(again, '/api/auth/private-storage', { enabled: false, password: 'second password 2' })).statusCode).toBe(200)
    const unsealed = await env.db.message.findUniqueOrThrow({ where: { id: message.id } })
    expect([unsealed.sealedBody, unsealed.text]).toEqual([null, 'Dear diary'])
  })
})

describe.skipIf(!servicesUp)('scheduled send', () => {
  let env: Awaited<ReturnType<typeof load>>
  let userId = ''

  beforeAll(async () => {
    env = await load()
  })
  afterAll(async () => {
    await env?.db.user.deleteMany({ where: { id: userId } })
  })

  it('goes back to scheduled after a failed attempt, and is marked failed only after the last', async () => {
    const { db, crypto } = env
    const user = await db.user.create({ data: { name: 'S', email: `s-${unique()}@test.local`, passwordHash: 'x' } })
    userId = user.id
    // SMTP port 1: every attempt fails.
    const account = await makeAccount(env, user.id)
    const outgoing = await db.outgoingMessage.create({
      data: { userId: user.id, accountId: account.id, status: 'scheduled', scheduledFor: new Date(), payload: { accountId: account.id, to: ['x@test.local'], subject: 'x', text: 'x' } },
    })
    const status = async () => (await db.outgoingMessage.findUniqueOrThrow({ where: { id: outgoing.id } })).status

    await expect(env.sendScheduled(outgoing.id, false)).rejects.toThrow()
    expect(await status()).toBe('scheduled')
    await expect(env.sendScheduled(outgoing.id, true)).rejects.toThrow()
    expect(await status()).toBe('failed')
  })

  it('never re-sends a message a crash left half-sent, and sends a claimed one only once', async () => {
    const { db } = env
    const account = await makeAccount(env, userId)
    const outgoing = await db.outgoingMessage.create({
      data: { userId, accountId: account.id, status: 'sending', scheduledFor: new Date(), payload: { accountId: account.id, to: ['x@test.local'], subject: 'x', text: 'x' } },
    })
    await env.failInterruptedSends()
    const after = await db.outgoingMessage.findUniqueOrThrow({ where: { id: outgoing.id } })
    expect(after.status).toBe('failed')
    expect(after.error).toMatch(/Check Sent/)
    // A worker finding it not "scheduled" leaves it alone instead of sending.
    await expect(env.sendScheduled(outgoing.id, true)).resolves.toBeUndefined()
    expect((await db.outgoingMessage.findUniqueOrThrow({ where: { id: outgoing.id } })).status).toBe('failed')
  })
})

describe.skipIf(!servicesUp)('POP3 sync', () => {
  let env: Awaited<ReturnType<typeof load>>
  let userId = ''

  beforeAll(async () => {
    env = await load()
  })
  afterAll(async () => {
    await env?.db.user.deleteMany({ where: { id: userId } })
  })

  it('downloads whole messages, including lines that start with a dot, and only once', async () => {
    const address = `pop-${unique()}@nexus.test`
    const smtp = nodemailer.createTransport({ host: 'localhost', port: 3025, secure: false, ignoreTLS: true })
    await smtp.sendMail({ from: 't@test.local', to: address, subject: 'Dots', text: 'line one\n.starts with a dot\n..two dots\nlast line' })
    smtp.close()

    const user = await env.db.user.create({ data: { name: 'P', email: `p-${unique()}@test.local`, passwordHash: 'x' } })
    userId = user.id
    const account = await makeAccount(env, user.id, { email: address, protocol: 'pop3', inPort: 3995, username: address })

    await env.syncAccount(account.id)
    await env.syncAccount(account.id) // a second sync must not download it again
    const stored = await env.db.message.findMany({ where: { accountId: account.id } })
    expect(stored).toHaveLength(1)
    expect(stored[0].text).toBe('line one\n.starts with a dot\n..two dots\nlast line')
  })
})
