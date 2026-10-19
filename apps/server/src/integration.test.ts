// Tests that need the real database, Redis and the GreenMail test mail server:
//   docker compose -f docker-compose.dev.yml up -d
// They are skipped when those aren't running, so `npm test` still works without Docker.
import { existsSync } from 'node:fs'
import { connect } from 'node:net'
import { resolve } from 'node:path'
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
  const [{ db }, crypto, { buildApp }, { syncAccount }, { withImap }] = await Promise.all([
    import('./db.ts'),
    import('./lib/crypto.ts'),
    import('./app.ts'),
    import('./features/mail/sync.ts'),
    import('./features/accounts/connect.ts'),
  ])
  crypto.setEncryptionSecret(process.env.APP_SECRET!)
  return { db, crypto, buildApp, syncAccount, withImap }
}

const unique = () => Math.random().toString(36).slice(2, 10)

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
    const account = await db.account.create({
      data: {
        ownerId: owner.id, email: 'shared@test.local', name: 'Shared', color: '#000000', protocol: 'imap', auth: 'password',
        inHost: 'localhost', inPort: 1, inTls: true, smtpHost: 'localhost', smtpPort: 1, smtpTls: true, username: 'x', secret: crypto.encrypt('x'),
      },
    })
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
    const account = await db.account.create({
      data: {
        ownerId: user.id, email: address, name: 'Sync', color: '#000000', protocol: 'imap', auth: 'password',
        inHost: 'localhost', inPort: 3993, inTls: true, smtpHost: 'localhost', smtpPort: 3465, smtpTls: true, username: address, secret: crypto.encrypt('x'),
      },
    })
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
