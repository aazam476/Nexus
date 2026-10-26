// Turns a raw email (RFC 822 bytes) into the fields Nexus stores and shows.
import { simpleParser, type AddressObject } from 'mailparser'
import { extractEvent, type CalendarEvent } from './events.ts'

export interface Person {
  name: string
  email: string
}

export interface AttachmentInfo {
  id: string // position in the parsed message; stable because we re-parse the same raw bytes
  filename: string
  contentType: string
  size: number
}

export interface ParsedMessage {
  messageId: string | null
  from: Person
  to: Person[]
  cc: Person[]
  subject: string
  date: Date
  text: string | null
  html: string | null
  preview: string
  attachments: AttachmentInfo[]
  security: 'pgp-encrypted' | 'pgp-signed' | 'smime-encrypted' | 'smime-signed' | null
  event: CalendarEvent | null
  // Signals used by classification and spam filtering.
  isMailingList: boolean
  isAutomated: boolean
  spamFlag: boolean
  spamScore: number | null
}

// mailparser gives addresses as one object or a list of them, each holding several addresses.
// This flattens that into a simple list of people, skipping entries without an address.
function people(field: AddressObject | AddressObject[] | undefined): Person[] {
  if (!field) return []
  const groups = Array.isArray(field) ? field : [field]
  const addresses = groups.flatMap((group) => group.value).filter((a) => a.address)
  return addresses.map((a) => ({ name: a.name || a.address!, email: a.address!.toLowerCase() }))
}

// A header's value as text. mailparser stores some headers as plain strings and others as
// objects like { value: 'text/html', params: {...} }.
function header(headers: Map<string, unknown>, name: string): string {
  const value = headers.get(name)
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'value' in value) return String(value.value)
  return String(value)
}

export async function parseRaw(raw: Buffer): Promise<ParsedMessage> {
  const mail = await simpleParser(raw) // cid: images in the HTML are turned into data: URLs
  const headers = mail.headers as Map<string, unknown>
  const html = typeof mail.html === 'string' ? mail.html : null
  const text = mail.text?.trim() || null

  const files = mail.attachments.map((a, index) => ({ ...a, index }))
  const attachments = files.filter(isAttachment).map((a) => ({
    id: String(a.index),
    filename: a.filename ?? `attachment-${a.index + 1}`,
    contentType: a.contentType,
    size: a.size,
  }))

  const icsTexts = files
    .filter((a) => a.contentType === 'text/calendar' || a.filename?.endsWith('.ics'))
    .map((a) => a.content.toString('utf8'))
  const from = people(mail.from)[0] ?? { name: 'Unknown sender', email: '' }

  return {
    messageId: mail.messageId ?? null,
    from,
    to: people(mail.to),
    cc: people(mail.cc),
    subject: mail.subject?.trim() || '(no subject)',
    date: mail.date ?? new Date(),
    text,
    html,
    preview: makePreview(html ?? text ?? ''),
    attachments,
    security: detectSecurity(headers, text),
    event: extractEvent({ html, icsTexts }),
    isMailingList: isMailingList(headers),
    isAutomated: isAutomated(headers),
    ...spamHeaders(headers),
  }
}

// What counts as an attachment, everywhere (reader, forwarding): not images embedded in the HTML,
// and not S/MIME signature parts (smime.p7s).
export function isAttachment(part: { related?: boolean; contentType: string }): boolean {
  const isSignaturePart = /pkcs7-(signature|mime)/.test(part.contentType) // application/pkcs7-signature, …-mime
  return !part.related && !isSignaturePart
}

// Newsletters and mailing lists send List-* headers (mailparser gathers them all under one "list"
// key) or "Precedence: bulk" / "Precedence: list".
function isMailingList(headers: Map<string, unknown>): boolean {
  return headers.has('list') || /bulk|list/i.test(header(headers, 'precedence'))
}

// "Auto-Submitted: auto-generated" (or anything except "no") marks mail a machine sent on its own.
function isAutomated(headers: Map<string, unknown>): boolean {
  const value = header(headers, 'auto-submitted')
  return value !== '' && value.toLowerCase() !== 'no'
}

// The short grey text under the subject in the list: the start of the message as plain text.
export function makePreview(content: string): string {
  return (
    content
      // Drop whole <head>, <style> and <script> blocks, contents included ("\1" repeats the tag name).
      .replace(/<(head|style|script)[\s\S]*?<\/\1>/gi, ' ')
      // Drop every other tag, keeping the text between them.
      .replace(/<[^>]+>/g, ' ')
      // Turn the common HTML entities back into characters. &amp; goes last, so "&amp;lt;" stays "&lt;".
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      // An encrypted message is unreadable gibberish; say what it is instead.
      .replace(/-----BEGIN PGP[\s\S]*/g, 'Encrypted message')
      // Squash runs of spaces and line breaks into single spaces.
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180)
  )
}

function detectSecurity(headers: Map<string, unknown>, text: string | null): ParsedMessage['security'] {
  const contentType = headers.get('content-type') as { value?: string; params?: Record<string, string> } | undefined
  const type = contentType?.value?.toLowerCase() ?? ''
  const protocol = contentType?.params?.protocol?.toLowerCase() ?? ''
  if (type === 'multipart/encrypted') return 'pgp-encrypted'
  if (type.includes('pkcs7-mime')) return 'smime-encrypted'
  if (type === 'multipart/signed') return protocol.includes('pgp') ? 'pgp-signed' : 'smime-signed'
  if (text?.includes('-----BEGIN PGP MESSAGE-----')) return 'pgp-encrypted'
  if (text?.includes('-----BEGIN PGP SIGNED MESSAGE-----')) return 'pgp-signed'
  return null
}

// Spam filters on the mail server (SpamAssassin, Rspamd) add headers like these:
//   X-Spam-Flag: YES
//   X-Spam-Status: Yes, score=12.4 required=5.0 ...
//   X-Spam-Score: 12.4
function spamHeaders(headers: Map<string, unknown>) {
  const status = header(headers, 'x-spam-status')
  const flag = /^yes/i.test(header(headers, 'x-spam-flag')) || /^yes/i.test(status)
  // The score from its own header, or the number after "score=" in X-Spam-Status (it may be negative).
  const scoreFromStatus = status.match(/score=(-?[\d.]+)/)?.[1]
  const scoreText = header(headers, 'x-spam-score') || header(headers, 'x-rspamd-score') || scoreFromStatus || ''
  const score = Number.parseFloat(scoreText)
  return { spamFlag: flag, spamScore: Number.isFinite(score) ? score : null }
}
