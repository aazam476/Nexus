// Opening connections to a mail account's servers: IMAP or POP3 for incoming, SMTP for outgoing.
import type { Account } from '@prisma/client'
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import { config } from '../../config.ts'
import { decrypt } from '../../lib/crypto.ts'
import { accessToken } from './oauth.ts'
import { Pop3 } from './pop3.ts'

const tls = { rejectUnauthorized: !config.MAIL_ALLOW_INSECURE_TLS }

type ServerSettings = Pick<Account, 'id' | 'auth' | 'secret' | 'username' | 'inHost' | 'inPort' | 'inTls' | 'smtpHost' | 'smtpPort' | 'smtpTls'>

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
  return Pop3.open({ host: account.inHost, port: account.inPort, tls: account.inTls, user: account.username, password: decrypt(account.secret), tlsOptions: tls })
}

export async function smtpTransport(account: ServerSettings) {
  const creds = await credentials(account)
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
export async function testConnection(account: ServerSettings & { protocol: string }) {
  if (account.protocol === 'imap') {
    await withImap(account, async () => undefined)
  } else {
    const pop3 = await openPop3(account)
    await pop3.uidl()
    await pop3.quit()
  }
  const transport = await smtpTransport(account)
  await transport.verify()
  transport.close()
}
