// Helpers for the integration tests (*.int.test.ts). They talk to Nexus the way the web app does:
// through HTTP requests with a session cookie, against a real database and a real test mail server.
import { randomBytes } from 'node:crypto'
import type { FastifyInstance, InjectOptions } from 'fastify'
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import type Mail from 'nodemailer/lib/mailer/index.js'
import { buildApp } from '../app.ts'
import { db } from '../db.ts'
import { hashPassword } from '../lib/crypto.ts'

export const PASSWORD = 'correct horse battery staple'

// A random suffix, so every test gets its own users and mailboxes on the shared test mail server.
export const unique = () => randomBytes(4).toString('hex')
export const uniqueAddress = (prefix = 'user') => `${prefix}-${unique()}@nexus.test`

// One app per test file. Closed by the caller in afterAll.
export const startApp = () => buildApp()

// A pretend browser: remembers the session cookie between requests, like a real one.
// Each one has its own IP address, as different people would, so the sign-in rate limit
// (10 tries a minute per address) only catches a test that is about rate limits.
export class Browser {
  cookie = ''
  ip = `10.${randomBytes(3).join('.')}`
  app: FastifyInstance
  constructor(app: FastifyInstance) {
    this.app = app
  }

  async request(method: InjectOptions['method'], url: string, body?: unknown, headers: Record<string, string> = {}) {
    const response = await this.app.inject({
      method,
      url,
      remoteAddress: this.ip,
      ...(body !== undefined &&
        (typeof body === 'string' || Buffer.isBuffer(body) ? { body } : { payload: body as object })),
      headers: { ...(this.cookie && { cookie: this.cookie }), ...headers },
    })
    // Keep the newest session cookie; an empty value means the server signed us out.
    const setCookie = [response.headers['set-cookie'] ?? []].flat().find((c) => c.startsWith('nexus_session='))
    if (setCookie) this.cookie = setCookie.split(';')[0].endsWith('=') ? '' : setCookie.split(';')[0]
    return response
  }

  get = (url: string) => this.request('GET', url)
  post = (url: string, body: unknown = {}) => this.request('POST', url, body)
  put = (url: string, body: unknown = {}) => this.request('PUT', url, body)
  patch = (url: string, body: unknown = {}) => this.request('PATCH', url, body)
  delete = (url: string) => this.request('DELETE', url)

  // For requests that must succeed: returns the JSON body, or fails the test with the server's error.
  async json<T = any>(method: InjectOptions['method'], url: string, body?: unknown): Promise<T> {
    const response = await this.request(method, url, body)
    if (response.statusCode >= 400) throw new Error(`${method} ${url} → ${response.statusCode}: ${response.body}`)
    return response.json() as T
  }
}

// A user created straight in the database, then signed in through the real login route.
export async function signedInUser(app: FastifyInstance, options: { role?: 'admin' | 'user'; name?: string } = {}) {
  const user = await db.user.create({
    data: {
      name: options.name ?? 'Test User',
      email: uniqueAddress('login'),
      passwordHash: await hashPassword(PASSWORD),
      role: options.role ?? 'user',
    },
  })
  const browser = new Browser(app)
  const login = await browser.post('/api/auth/login', { email: user.email, password: PASSWORD })
  if (login.statusCode !== 200) throw new Error(`Could not sign in: ${login.body}`)
  return { user, browser }
}

// GreenMail accepts any password and creates a mailbox the first time an address is used.
export const greenMail = (email: string, protocol: 'imap' | 'pop3' = 'imap') => ({
  email,
  name: 'Test mailbox',
  protocol,
  password: 'any password',
  inHost: 'localhost',
  inPort: protocol === 'imap' ? 3993 : 3995,
  inTls: true,
  smtpHost: 'localhost',
  smtpPort: 3465,
  smtpTls: true,
  username: email,
})

// Adds a GreenMail account through the API (which also tests the connection). Returns its id.
export async function addAccount(browser: Browser, email = uniqueAddress('box'), protocol: 'imap' | 'pop3' = 'imap') {
  const { id } = await browser.json<{ id: string }>('POST', '/api/accounts', greenMail(email, protocol))
  return { id, email }
}

// Delivers mail into a GreenMail mailbox, as if someone on the internet sent it.
export async function deliver(to: string, mail: Mail.Options) {
  const smtp = nodemailer.createTransport({ host: 'localhost', port: 3025, secure: false, ignoreTLS: true })
  try {
    await smtp.sendMail({ from: 'Sender <sender@example.test>', to, ...mail })
  } finally {
    smtp.close()
  }
}

// Reads a GreenMail mailbox directly, to check what Nexus really did on the mail server.
export async function onMailServer<T>(email: string, work: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = new ImapFlow({
    host: 'localhost',
    port: 3993,
    secure: true,
    auth: { user: email, pass: 'x' },
    tls: { rejectUnauthorized: false },
    logger: false,
  })
  await client.connect()
  try {
    return await work(client)
  } finally {
    await client.logout()
  }
}

// Subjects of the messages in a server folder, oldest first.
export const subjectsOnServer = (email: string, folder = 'INBOX') =>
  onMailServer(email, async (client) => {
    const lock = await client.getMailboxLock(folder)
    try {
      const subjects: string[] = []
      if ((client.mailbox as { exists: number }).exists === 0) return subjects
      for await (const message of client.fetch('1:*', { envelope: true }))
        subjects.push(message.envelope?.subject ?? '')
      return subjects
    } finally {
      lock.release()
    }
  })

// Waits for something that happens in the background (a job, a delivery), checking every 200 ms.
export async function waitFor<T>(
  check: () => Promise<T | undefined | null | false>,
  what: string,
  timeout = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeout
  for (;;) {
    const result = await check()
    if (result) return result
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

// A self-signed S/MIME certificate and its key, packed as a password-protected .p12 file
// (what people export from their mail app or get from a certificate authority).
export async function makeP12(email: string, password: string, days = 30): Promise<Buffer> {
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'nexus-test-cert-'))
  try {
    const key = join(dir, 'key.pem')
    const cert = join(dir, 'cert.pem')
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        key,
        '-out',
        cert,
        '-days',
        String(days),
        '-subj',
        `/CN=Test/emailAddress=${email}`,
        '-addext',
        `subjectAltName=email:${email}`,
      ],
      { stdio: 'ignore' },
    )
    execFileSync(
      'openssl',
      ['pkcs12', '-export', '-inkey', key, '-in', cert, '-out', join(dir, 'id.p12'), '-passout', `pass:${password}`],
      { stdio: 'ignore' },
    )
    return readFileSync(join(dir, 'id.p12'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
