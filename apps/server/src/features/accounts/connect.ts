// Opening connections to a mail account's servers: IMAP or POP3 for incoming, SMTP for outgoing.
import type { Account } from '@prisma/client'
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import { config } from '../../config.ts'
import { decrypt } from '../../lib/crypto.ts'
import { errorMessage } from '../../lib/http.ts'
import { accessToken } from './oauth.ts'
import { Pop3 } from './pop3.ts'

// rejectUnauthorized: refuse servers whose certificate isn't valid and trusted (the safe default).
// MAIL_ALLOW_INSECURE_TLS turns that off, for a home mail server with a self-signed certificate.
const tls = { rejectUnauthorized: !config.MAIL_ALLOW_INSECURE_TLS }

type ServerSettings = Pick<
  Account,
  | 'id'
  | 'auth'
  | 'secret'
  | 'username'
  | 'inHost'
  | 'inPort'
  | 'inTls'
  | 'smtpHost'
  | 'smtpPort'
  | 'smtpTls'
  | 'smtpUsername'
  | 'smtpSecret'
>

// What to log in with: the stored password, or (for Google/Microsoft accounts) a fresh OAuth access token.
async function credentials(account: ServerSettings) {
  return account.auth === 'password'
    ? { user: account.username, pass: decrypt(account.secret) }
    : { user: account.username, accessToken: await accessToken(account) }
}

export async function openImap(account: ServerSettings): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: account.inHost,
    port: account.inPort,
    secure: account.inTls,
    auth: await credentials(account),
    tls,
    logger: false,
  })
  await client.connect()
  return client
}

// Runs `work` with a connected IMAP client and always logs out afterwards.
export async function withImap<T>(account: ServerSettings, work: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = await openImap(account)
  try {
    return await work(client)
  } finally {
    await client.logout().catch(() => client.close())
  }
}

export function openPop3(account: ServerSettings) {
  if (account.auth !== 'password') throw new Error('POP3 accounts use a password')
  return Pop3.open({
    host: account.inHost,
    port: account.inPort,
    tls: account.inTls,
    user: account.username,
    password: decrypt(account.secret),
    tlsOptions: tls,
  })
}

// Sending usually uses the same login as receiving. Some hosts and mail relays have a separate one.
export async function sendingCredentials(account: ServerSettings) {
  if (account.smtpUsername && account.smtpSecret)
    return { user: account.smtpUsername, pass: decrypt(account.smtpSecret) }
  return credentials(account)
}

export async function smtpTransport(account: ServerSettings) {
  const creds = await sendingCredentials(account)
  return nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpTls, // false = upgrade with STARTTLS
    requireTLS: !account.smtpTls,
    tls,
    auth: 'accessToken' in creds ? { type: 'OAuth2', user: creds.user, accessToken: creds.accessToken } : creds,
  })
}

// Used when adding or editing an account: proves both servers accept the login before saving.
// Errors say which server failed, and what to change when the security setting doesn't fit the port.
export async function testConnection(account: ServerSettings & { protocol: string }) {
  await explained('Incoming mail', account.inPort, account.inTls, async () => {
    if (account.protocol === 'imap') {
      await withImap(account, async () => undefined)
    } else {
      const pop3 = await openPop3(account)
      await pop3.uidl()
      await pop3.quit()
    }
  })
  await explained('Outgoing mail (SMTP)', account.smtpPort, account.smtpTls, async () => {
    const transport = await smtpTransport(account)
    await transport.verify()
    transport.close()
  })
}

async function explained(server: string, port: number, tls: boolean, work: () => Promise<void>) {
  try {
    await work()
  } catch (error) {
    const message = errorMessage(error)
    // OpenSSL's "wrong version number": we started with SSL/TLS, but the server answered in plain
    // text, because on this port it expects STARTTLS (like 587 for sending or 143 for IMAP).
    if (tls && /wrong version number/i.test(message)) {
      throw new Error(
        `${server}: the server on port ${port} doesn't use SSL/TLS from the start. Choose STARTTLS for this port, or switch to its SSL/TLS port (usually 993 for IMAP, 995 for POP3, 465 for SMTP).`,
      )
    }
    throw new Error(`${server}: ${message}`)
  }
}
