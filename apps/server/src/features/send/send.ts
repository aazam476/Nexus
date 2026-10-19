// Turning what the composer wrote into a real email, and sending it.
import type { Account } from '@prisma/client'
import MailComposer from 'nodemailer/lib/mail-composer/index.js'
import { z } from 'zod'
import { db } from '../../db.ts'
import { decrypt } from '../../lib/crypto.ts'
import { HttpError } from '../../lib/http.ts'
import { smtpTransport, withImap } from '../accounts/connect.ts'
import { parseRaw } from '../mail/parse.ts'
import { saveMessage } from '../mail/store.ts'
import { discoverFolders, localFolders } from '../mail/sync.ts'
import { extractInlineImages, mimeEntity, rewrap } from './mime.ts'
import * as smime from './smime.ts'

const address = z.string().trim().email()

// What the web app sends. Also stored as-is for drafts and scheduled mail.
export const outgoingSchema = z.object({
  accountId: z.string(),
  to: z.array(address).default([]),
  cc: z.array(address).default([]),
  bcc: z.array(address).default([]),
  subject: z.string().max(998).default(''),
  html: z.string().optional(), // absent for PGP mail, which is plain text by nature
  text: z.string().default(''),
  attachments: z
    .array(z.object({ filename: z.string(), contentType: z.string(), content: z.string() })) // content is base64
    .default([]),
  inReplyTo: z.string().optional(), // Message-ID of the mail being answered, for threading
  smime: z.object({ sign: z.boolean(), encrypt: z.boolean() }).default({ sign: false, encrypt: false }),
})
export type OutgoingPayload = z.infer<typeof outgoingSchema>

export async function buildMessage(account: Account, fromName: string, payload: OutgoingPayload, userId: string): Promise<Buffer> {
  const { html, images } = payload.html ? extractInlineImages(payload.html) : { html: undefined, images: [] }
  const composer = new MailComposer({
    from: { name: fromName, address: account.email },
    // Bcc-only mail gets the standard placeholder, so recipients see "undisclosed recipients" instead of a blank To.
    to: payload.to.length + payload.cc.length === 0 ? 'undisclosed-recipients:;' : payload.to,
    cc: payload.cc,
    // Bcc only goes in the SMTP envelope (see sendNow); it is never written into the message.
    subject: payload.subject,
    text: payload.text,
    html,
    inReplyTo: payload.inReplyTo,
    references: payload.inReplyTo,
    attachments: [
      ...payload.attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, content: Buffer.from(a.content, 'base64') })),
      ...images.map((i) => ({ filename: i.filename, contentType: i.contentType, content: i.content, cid: i.cid })),
    ],
  })
  let raw: Buffer = await composer.compile().build()

  if (payload.smime.sign || payload.smime.encrypt) {
    const cert = await db.smimeCert.findFirst({ where: { userId, email: account.email }, orderBy: { createdAt: 'desc' } })
    if (!cert) throw new HttpError(400, `Upload an S/MIME certificate for ${account.email} first`)
    let entity = mimeEntity(raw)
    if (payload.smime.sign) entity = await smime.sign(entity, cert.certPem, decrypt(cert.keyPem))
    if (payload.smime.encrypt) {
      const recipients = [...payload.to, ...payload.cc, ...payload.bcc]
      const contacts = await db.contact.findMany({ where: { userId, emails: { hasSome: recipients }, smimeCert: { not: null } } })
      const missing = recipients.filter((email) => !contacts.some((c) => c.emails.includes(email)))
      if (missing.length) throw new HttpError(400, `No S/MIME certificate for ${missing.join(', ')}. They need to send you a signed message first.`)
      entity = await smime.encrypt(entity, [cert.certPem, ...contacts.map((c) => c.smimeCert!)])
    }
    raw = rewrap(raw, entity)
  }
  return raw
}

// Sends immediately and files a copy in Sent. Returns once the SMTP server has accepted it.
export async function sendNow(userId: string, payload: OutgoingPayload) {
  const recipients = [...payload.to, ...payload.cc, ...payload.bcc]
  if (recipients.length === 0) throw new HttpError(400, 'Add at least one recipient in To, Cc or Bcc')
  const account = await db.account.findUniqueOrThrow({ where: { id: payload.accountId } })
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } })
  const raw = await buildMessage(account, user.name, payload, userId)

  const transport = await smtpTransport(account)
  try {
    await transport.sendMail({ envelope: { from: account.email, to: recipients }, raw })
  } finally {
    transport.close()
  }

  await fileInSent(account, raw)
  await rememberRecipients(userId, recipients)
}

async function fileInSent(account: Account, raw: Buffer) {
  // Gmail and Outlook file sent mail themselves; adding our own copy would show it twice.
  if (account.auth !== 'password') return
  if (account.protocol === 'imap') {
    await withImap(account, async (client) => {
      const sent = (await discoverFolders(client, account.id)).get('sent')!
      await client.append(sent.path, raw, ['\\Seen'])
    })
  } else {
    const sent = (await localFolders(account.id)).get('sent')!
    const parsed = await parseRaw(raw)
    await saveMessage({ accountId: account.id, folderId: sent.id, raw, parsed, unread: false, starred: false, category: 'people', labels: [] })
  }
}

// Everyone you write to becomes a contact, which powers address autocomplete.
async function rememberRecipients(userId: string, emails: string[]) {
  for (const email of emails) {
    const existing = await db.contact.findFirst({ where: { userId, emails: { has: email } } })
    if (existing) await db.contact.update({ where: { id: existing.id }, data: { messageCount: { increment: 1 } } })
    else await db.contact.create({ data: { userId, name: email.split('@')[0], emails: [email], messageCount: 1 } })
  }
}

// Called by the job queue when a scheduled message is due.
export async function sendScheduled(outgoingId: string) {
  const outgoing = await db.outgoingMessage.findUnique({ where: { id: outgoingId } })
  if (!outgoing || outgoing.status !== 'scheduled') return // cancelled or already sent
  await db.outgoingMessage.update({ where: { id: outgoingId }, data: { status: 'sending' } })
  try {
    await sendNow(outgoing.userId, outgoingSchema.parse(outgoing.payload))
    await db.outgoingMessage.delete({ where: { id: outgoingId } })
  } catch (error) {
    await db.outgoingMessage.update({ where: { id: outgoingId }, data: { status: 'failed', error: (error as Error).message } })
    throw error
  }
}
