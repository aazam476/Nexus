// Opening connections to a mail account's servers: IMAP or POP3 for incoming, SMTP for outgoing.
import type { Account } from '@prisma/client'
import { ImapFlow } from 'imapflow'
import Pop3Command from 'node-pop3'
import nodemailer from 'nodemailer'
import { config } from '../../config.ts'
import { decrypt } from '../../lib/crypto.ts'
import { accessToken } from './oauth.ts'

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
  return new Pop3Command({
    host: account.inHost,
    port: account.inPort,
    tls: account.inTls,
    user: account.username,
    password: decrypt(account.secret),
    timeout: 30_000,
    tlsOptions: tls,
    parseStreamToString: false, // RETR gives the raw bytes, so 8-bit mail isn't mangled
  })
}

// Downloads message number `n` as raw bytes.
export async function pop3Retrieve(pop3: Pop3Command, n: number): Promise<Buffer> {
  const result = await pop3.RETR(n)
  if (typeof result === 'string') return Buffer.from(result, 'binary')
  const chunks: Buffer[] = []
  for await (const chunk of result as unknown as AsyncIterable<Buffer | string>) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
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
    const pop3 = openPop3(account)
    await pop3.UIDL()
    await pop3.QUIT()
  }
  const transport = await smtpTransport(account)
  await transport.verify()
  transport.close()
}
