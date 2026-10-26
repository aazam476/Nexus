// Saving parsed mail into the database, and the per-user settings that decide where it goes.
import type { Prisma } from '@prisma/client'
import { asJson, db } from '../../db.ts'
import type { ParsedMessage } from './parse.ts'
import { sealedFields } from './private.ts'
import { applyRules, categoryOf, isSpam, type Category, type RuleInput } from './sorting.ts'

export interface SortingContext {
  rules: RuleInput[]
  blocked: string[]
  spamThreshold: number
  sealFor: string | null // the owner's public key when they use private storage
}

// Loaded once per sync run, not once per message.
export async function loadSortingContext(userId: string): Promise<SortingContext> {
  const [rules, blocked, preference, user] = await Promise.all([
    db.rule.findMany({ where: { userId }, orderBy: { position: 'asc' } }),
    db.blockedSender.findMany({ where: { userId } }),
    db.preference.findUnique({ where: { userId } }),
    db.user.findUnique({ where: { id: userId }, select: { privateStorage: true, storagePublicKey: true } }),
  ])
  return {
    rules,
    blocked: blocked.map((b) => b.pattern),
    spamThreshold: preference?.spamThreshold ?? 5,
    sealFor: user?.privateStorage ? user.storagePublicKey : null,
  }
}

export interface SortDecision {
  category: Category
  labels: string[]
  markRead: boolean
  moveTo?: string // folder role, e.g. "spam" or "archive"
}

// What should happen to a message that just arrived in the inbox.
export function sortIncoming(parsed: ParsedMessage, context: SortingContext): SortDecision {
  const outcome = applyRules(
    {
      fromEmail: parsed.from.email,
      fromName: parsed.from.name,
      to: parsed.to.map((p) => p.email),
      subject: parsed.subject,
      text: parsed.text ?? '',
    },
    context.rules,
  )
  const spam =
    outcome.spam ||
    isSpam(
      { fromEmail: parsed.from.email, spamFlag: parsed.spamFlag, spamScore: parsed.spamScore },
      context.blocked,
      context.spamThreshold,
    )
  return {
    category: outcome.category ?? categoryOf(parsed),
    labels: outcome.labels,
    markRead: outcome.markRead,
    moveTo: spam ? 'spam' : outcome.moveTo,
  }
}

interface SaveInput {
  accountId: string
  folderId: string
  raw: Buffer
  parsed: ParsedMessage
  uid?: number
  remoteId?: string
  unread: boolean
  starred: boolean
  category: Category
  labels: string[]
  sealFor?: string | null // seal before writing, so no readable copy ever reaches the database
}

// Inserts the message; returns false if it was already stored (same folder + UID, or same POP3 id).
export async function saveMessage(input: SaveInput): Promise<boolean> {
  const { parsed } = input
  const data: Prisma.MessageUncheckedCreateInput = {
    accountId: input.accountId,
    folderId: input.folderId,
    uid: input.uid,
    remoteId: input.remoteId,
    messageId: parsed.messageId,
    fromName: parsed.from.name,
    fromEmail: parsed.from.email,
    to: asJson(parsed.to),
    cc: asJson(parsed.cc),
    subject: parsed.subject,
    preview: parsed.preview,
    text: parsed.text,
    html: parsed.html,
    date: parsed.date,
    unread: input.unread,
    starred: input.starred,
    category: input.category,
    labels: input.labels,
    attachments: asJson(parsed.attachments),
    security: parsed.security,
    event: parsed.event ? asJson(parsed.event) : undefined,
    raw: Uint8Array.from(input.raw),
    ...(input.sealFor &&
      sealedFields(
        {
          raw: input.raw,
          html: parsed.html,
          text: parsed.text,
          preview: parsed.preview,
          attachments: parsed.attachments,
          event: parsed.event,
        },
        input.sealFor,
      )),
  }
  try {
    await db.message.create({ data })
    return true
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return false // unique constraint: already have it
    throw error
  }
}
