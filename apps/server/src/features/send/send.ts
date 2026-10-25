// Turning what the composer wrote into a real email, and sending it.
import type { Account } from '@prisma/client'
import MailComposer from 'nodemailer/lib/mail-composer/index.js'
import { z } from 'zod'
import { db } from '../../db.ts'
import { decrypt } from '../../lib/crypto.ts'
import { HttpError, errorMessage } from '../../lib/http.ts'
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
  forwardOf: z.string().optional(), // id of a message whose attachments go along (forwarding); expanded by the send route
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
  } catch (error) {
    // Nothing was sent. Say why, in the words of the mail server (a wrong password, a refused recipient…).
    throw new HttpError(502, `Your mail server did not accept the message: ${errorMessage(error)}`)
  } finally {
    transport.close()
  }

  // The mail is out. Problems from here on must not look like a failed send,
  // or the user (or a retry) would send it a second time.
  await fileInSent(account, raw).catch((error) => console.warn(`Sent, but could not file a copy in Sent for ${account.email}: ${error.message}`))
  await rememberRecipients(userId, recipients).catch((error) => console.warn(`Sent, but could not update contacts: ${error.message}`))
}

// These providers put sent mail in Sent themselves; our own copy would show up twice.
const filesSentMailItself = (smtpHost: string) => /(^|\.)(gmail\.com|googlemail\.com|office365\.com|outlook\.com)$/i.test(smtpHost)

async function fileInSent(account: Account, raw: Buffer) {
  if (filesSentMailItself(account.smtpHost)) return
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

// Called by the job queue when a scheduled message is due. On failure it goes back to
// "scheduled" so the queue's retry really retries; only the last attempt marks it failed.
export async function sendScheduled(outgoingId: string, lastAttempt: boolean) {
  const outgoing = await db.outgoingMessage.findUnique({ where: { id: outgoingId } })
  if (!outgoing) return // cancelled or already sent
  // Claim it in one step, so it is only ever sent once even if two workers pick it up.
  const claimed = await db.outgoingMessage.updateMany({ where: { id: outgoingId, status: 'scheduled' }, data: { status: 'sending' } })
  if (!claimed.count) return
  try {
    await sendNow(outgoing.userId, outgoingSchema.parse(outgoing.payload))
    await db.outgoingMessage.delete({ where: { id: outgoingId } })
  } catch (error) {
    await db.outgoingMessage.update({ where: { id: outgoingId }, data: { status: lastAttempt ? 'failed' : 'scheduled', error: errorMessage(error) } })
    throw error
  }
}

// After a crash, a message still "sending" may or may not have reached the SMTP server.
// Sending it again could deliver it twice, so mark it failed and let the user decide:
// it shows in Scheduled with this note, next to "Send now" and "Cancel".
export async function failInterruptedSends() {
  await db.outgoingMessage.updateMany({
    where: { status: 'sending' },
    data: { status: 'failed', error: 'Nexus stopped while sending this. Check Sent before sending it again.' },
  })
}
