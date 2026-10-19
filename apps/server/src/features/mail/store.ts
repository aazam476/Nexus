// Saving parsed mail into the database, and the per-user settings that decide where it goes.
import type { Prisma } from '@prisma/client'
import { db } from '../../db.ts'
import type { ParsedMessage } from './parse.ts'
import { applyRules, classify, isSpam, type Category, type RuleInput } from './sorting.ts'

export interface SortingContext {
  rules: RuleInput[]
  blocked: string[]
  spamThreshold: number
}

// Loaded once per sync run, not once per message.
export async function loadSortingContext(userId: string): Promise<SortingContext> {
  const [rules, blocked, preference] = await Promise.all([
    db.rule.findMany({ where: { userId }, orderBy: { position: 'asc' } }),
    db.blockedSender.findMany({ where: { userId } }),
    db.preference.findUnique({ where: { userId } }),
  ])
  return { rules, blocked: blocked.map((b) => b.pattern), spamThreshold: preference?.spamThreshold ?? 5 }
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
    { fromEmail: parsed.from.email, fromName: parsed.from.name, to: parsed.to.map((p) => p.email), subject: parsed.subject, text: parsed.text ?? '' },
    context.rules,
  )
  const spam = outcome.spam || isSpam({ fromEmail: parsed.from.email, spamFlag: parsed.spamFlag, spamScore: parsed.spamScore }, context.blocked, context.spamThreshold)
  return {
    category: outcome.category ?? classify({ fromEmail: parsed.from.email, subject: parsed.subject, isMailingList: parsed.isMailingList, isAutomated: parsed.isAutomated, hasEvent: !!parsed.event }),
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
    to: parsed.to as unknown as Prisma.InputJsonValue,
    cc: parsed.cc as unknown as Prisma.InputJsonValue,
    subject: parsed.subject,
    preview: parsed.preview,
    text: parsed.text,
    html: parsed.html,
    date: parsed.date,
    unread: input.unread,
    starred: input.starred,
    category: input.category,
    labels: input.labels,
    attachments: parsed.attachments as unknown as Prisma.InputJsonValue,
    security: parsed.security,
    event: (parsed.event ?? undefined) as Prisma.InputJsonValue | undefined,
    raw: Uint8Array.from(input.raw),
  }
  try {
    await db.message.create({ data })
    return true
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return false // unique constraint: already have it
    throw error
  }
}
