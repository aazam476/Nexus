// Moving mail in and out of private storage, and reading it either way.
// Sender, recipients, subject, date and labels stay readable so lists, sorting and search work.
import type { KeyObject } from 'node:crypto'
import type { Message, Prisma } from '@prisma/client'
import { simpleParser } from 'mailparser'
import { asJson, db } from '../../db.ts'
import { loadBody } from '../../lib/access.ts'
import { forbidden } from '../../lib/http.ts'
import { sealJson, unsealJson } from '../../lib/sealed.ts'
import type { AttachmentInfo } from './parse.ts'
import type { CalendarEvent } from './events.ts'

interface Summary {
  preview: string
  attachments: AttachmentInfo[]
  event: CalendarEvent | null
}

interface Body {
  raw: string // base64
  html: string | null
  text: string | null
}

// The columns to write when sealing. Plain columns are blanked so nothing readable is left behind.
export function sealedFields(
  plain: {
    raw: Buffer
    html: string | null
    text: string | null
    preview: string
    attachments: unknown
    event: unknown
  },
  publicKey: string,
) {
  return {
    sealedSummary: Uint8Array.from(
      sealJson({ preview: plain.preview, attachments: plain.attachments, event: plain.event ?? null }, publicKey),
    ),
    sealedBody: Uint8Array.from(
      sealJson({ raw: plain.raw.toString('base64'), html: plain.html, text: plain.text }, publicKey),
    ),
    raw: new Uint8Array(),
    html: null,
    text: null,
    preview: '',
    attachments: asJson([]),
    event: undefined,
  }
}

type Stored = Pick<Message, 'preview' | 'attachments' | 'event' | 'sealedSummary'>

// For list rows. Without the key, a sealed message shows no preview rather than failing the whole list.
export function openSummary(message: Stored, key: KeyObject | null): Summary {
  if (!message.sealedSummary) {
    // Not sealed: the columns hold it as is. (They are JSON columns, so tell TypeScript what's inside.)
    return {
      preview: message.preview,
      attachments: message.attachments as unknown as AttachmentInfo[],
      event: message.event as CalendarEvent | null,
    }
  }
  if (!key) return { preview: '', attachments: [], event: null }
  return unsealJson<Summary>(message.sealedSummary, key)
}

// For reading a message, its attachments, or exporting it.
export function openBody(
  message: Pick<Message, 'raw' | 'html' | 'text' | 'sealedBody'>,
  key: KeyObject | null,
): { raw: Buffer; html: string | null; text: string | null } {
  if (!message.sealedBody) return { raw: Buffer.from(message.raw), html: message.html, text: message.text }
  if (!key) throw forbidden('This message is in private storage. Only its owner can read it, while signed in.')
  const body = unsealJson<Body>(message.sealedBody, key)
  return { raw: Buffer.from(body.raw, 'base64'), html: body.html, text: body.text }
}

const BATCH = 100

// Seals every not-yet-sealed message in these accounts. Also used after each sync to catch
// anything an in-flight sync stored just before private storage was turned on.
export async function sealAccounts(accountIds: string[], publicKey: string) {
  for (;;) {
    const batch = await db.message.findMany({ where: { accountId: { in: accountIds }, sealedBody: null }, take: BATCH })
    if (!batch.length) return
    for (const m of batch) {
      await db.message.update({ where: { id: m.id }, data: sealedFields({ ...m, raw: Buffer.from(m.raw) }, publicKey) })
    }
  }
}

// Opens every sealed message in a user's accounts again, after private storage was turned off.
// It can be stopped at any point and run again later: each run only touches messages still sealed.
// It stops by itself if the user turns private storage back on meanwhile, so the two never fight.
export async function unsealUserMail(userId: string, key: KeyObject) {
  for (;;) {
    const user = await db.user.findUnique({ where: { id: userId }, select: { privateStorage: true } })
    if (!user || user.privateStorage) return
    const batch = await db.message.findMany({
      where: { account: { ownerId: userId }, sealedBody: { not: null } },
      take: BATCH,
    })
    if (!batch.length) return
    for (const m of batch) {
      const summary = openSummary(m, key)
      const body = openBody(m, key)
      await db.message.update({
        where: { id: m.id },
        data: {
          raw: Uint8Array.from(body.raw),
          html: body.html,
          text: body.text,
          preview: summary.preview,
          attachments: asJson(summary.attachments),
          event: summary.event ? asJson(summary.event) : undefined,
          sealedSummary: null,
          sealedBody: null,
        },
      })
    }
  }
}

// Every part of a stored message, in the order attachment ids refer to (see parse.ts).
// Callers must have checked access with requireMessage first.
export async function messageParts(messageId: string, key: KeyObject | null) {
  return (await simpleParser(openBody(await loadBody(messageId), key).raw)).attachments
}
