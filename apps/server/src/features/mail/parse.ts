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

const people = (field: AddressObject | AddressObject[] | undefined): Person[] =>
  (Array.isArray(field) ? field : field ? [field] : [])
    .flatMap((group) => group.value)
    .filter((a) => a.address)
    .map((a) => ({ name: a.name || a.address!, email: a.address!.toLowerCase() }))

const header = (headers: Map<string, unknown>, name: string) => {
  const value = headers.get(name)
  if (value == null) return ''
  return typeof value === 'string' ? value : typeof value === 'object' && 'value' in value ? String(value.value) : String(value)
}

export async function parseRaw(raw: Buffer): Promise<ParsedMessage> {
  const mail = await simpleParser(raw) // cid: images in the HTML are turned into data: URLs
  const headers = mail.headers as Map<string, unknown>
  const html = typeof mail.html === 'string' ? mail.html : null
  const text = mail.text?.trim() || null

  const files = mail.attachments.map((a, index) => ({ ...a, index }))
  const attachments = files
    // Images embedded in the HTML and S/MIME signature parts (smime.p7s) aren't attachments to the reader.
    .filter((a) => !a.related && !/pkcs7-(signature|mime)/.test(a.contentType))
    .map((a) => ({ id: String(a.index), filename: a.filename ?? `attachment-${a.index + 1}`, contentType: a.contentType, size: a.size }))

  const icsTexts = files.filter((a) => a.contentType === 'text/calendar' || a.filename?.endsWith('.ics')).map((a) => a.content.toString('utf8'))
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
    // mailparser gathers List-Unsubscribe, List-Id, etc. under one "list" key.
    isMailingList: headers.has('list') || /bulk|list/i.test(header(headers, 'precedence')),
    isAutomated: !!header(headers, 'auto-submitted') && !/^no$/i.test(header(headers, 'auto-submitted')),
    ...spamHeaders(headers),
  }
}

export function makePreview(content: string): string {
  return content
    .replace(/<(head|style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/-----BEGIN PGP[\s\S]*/g, 'Encrypted message')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
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

// SpamAssassin and Rspamd both add headers like these.
function spamHeaders(headers: Map<string, unknown>) {
  const status = header(headers, 'x-spam-status')
  const flag = /^yes/i.test(header(headers, 'x-spam-flag')) || /^yes/i.test(status)
  const scoreText = header(headers, 'x-spam-score') || header(headers, 'x-rspamd-score') || status.match(/score=(-?[\d.]+)/)?.[1] || ''
  const score = Number.parseFloat(scoreText)
  return { spamFlag: flag, spamScore: Number.isFinite(score) ? score : null }
}
