// Decides where a new message goes (its smart-inbox category, labels, spam) and whether a sync can skip work.
// Pure functions, so they are easy to test and reason about.

import type { ParsedMessage } from './parse.ts'

export type Category = 'people' | 'travel' | 'notifications' | 'newsletters'

interface Classifiable {
  fromEmail: string
  subject: string
  isMailingList: boolean
  isAutomated: boolean
  hasEvent: boolean
}

// Mailbox names machines send from. "-?" means an optional dash and "s?" an optional s, so
// "no-?reply" matches both "noreply" and "no-reply", and "alerts?" both "alert" and "alerts".
const AUTOMATED_MAILBOXES = [
  'no-?reply',
  'do-?not-?reply',
  'notifications?',
  'notify',
  'alerts?',
  'mailer-daemon',
  'postmaster',
  'bounces?',
  'billing',
  'invoices?',
  'receipts?',
  'accounts?',
  'security',
  'admin',
  'system',
]
// Matches an address that starts with one of those names, followed by the end of the name: "@",
// or a separator like "+", ".", "-" or "_". So "noreply@x.com" and "alerts+github@x.com" match,
// but "adminton@x.com" doesn't.
const automatedSender = new RegExp(`^(${AUTOMATED_MAILBOXES.join('|')})([+.\\-_@]|$)`, 'i')

// Subjects that mean travel. "\b" (in the regex) means "whole words only", so "flight" matches but "inflight" doesn't.
const TRAVEL_WORDS = [
  'booking',
  'itinerary',
  'boarding pass',
  'e-?ticket',
  'flight',
  'check-?in',
  'reservation',
  'your trip',
]
const travelSubject = new RegExp(`\\b(${TRAVEL_WORDS.join('|')})\\b`, 'i')

export function classify(message: Classifiable): Category {
  if (message.hasEvent || travelSubject.test(message.subject)) return 'travel'
  const fromAMachine =
    message.isAutomated || automatedSender.test(message.fromEmail) || message.fromEmail.includes('noreply')
  if (fromAMachine) return 'notifications'
  if (message.isMailingList) return 'newsletters'
  return 'people'
}

// The section a freshly parsed message belongs in, before the user's rules have a say.
export function categoryOf(
  parsed: Pick<ParsedMessage, 'from' | 'subject' | 'isMailingList' | 'isAutomated' | 'event'>,
) {
  return classify({
    fromEmail: parsed.from.email,
    subject: parsed.subject,
    isMailingList: parsed.isMailingList,
    isAutomated: parsed.isAutomated,
    hasEvent: !!parsed.event,
  })
}

// ---------- Rules ----------

export interface RuleInput {
  field: string // "from" | "to" | "subject" | "body"
  contains: string
  action: string // "label" | "move" | "category" | "mark-read" | "spam"
  value: string | null
  enabled: boolean
}

interface Matchable {
  fromEmail: string
  fromName: string
  to: string[]
  subject: string
  text: string
}

export interface RuleOutcome {
  category?: Category
  labels: string[]
  markRead: boolean
  moveTo?: string
  spam: boolean
}

export function applyRules(message: Matchable, rules: RuleInput[]): RuleOutcome {
  const outcome: RuleOutcome = { labels: [], markRead: false, spam: false }
  for (const rule of rules) {
    if (!rule.enabled || !rule.contains) continue
    const matches = fieldText(message, rule.field).toLowerCase().includes(rule.contains.toLowerCase())
    if (!matches) continue

    if (rule.action === 'label' && rule.value) outcome.labels.push(rule.value)
    if (rule.action === 'move' && rule.value) outcome.moveTo = rule.value
    if (rule.action === 'category' && rule.value) outcome.category = rule.value as Category
    if (rule.action === 'mark-read') outcome.markRead = true
    if (rule.action === 'spam') outcome.spam = true
  }
  return outcome
}

// The text a rule looks in. "from" covers both the sender's name and address.
function fieldText(message: Matchable, field: string): string {
  if (field === 'from') return `${message.fromName} ${message.fromEmail}`
  if (field === 'to') return message.to.join(' ')
  if (field === 'subject') return message.subject
  if (field === 'body') return message.text
  return ''
}

// ---------- Spam ----------

// "spam@example.com" blocks one address; "example.com" blocks the domain and its subdomains.
export function isBlocked(fromEmail: string, patterns: string[]): boolean {
  const email = fromEmail.toLowerCase()
  const domain = email.split('@')[1] ?? ''
  return patterns.some((raw) => {
    const pattern = raw.toLowerCase().replace(/^@/, '') // "@example.com" means the same as "example.com"
    if (pattern.includes('@')) return email === pattern // one address
    return domain === pattern || domain.endsWith(`.${pattern}`) // a domain, or any subdomain of it
  })
}

export function isSpam(
  message: { fromEmail: string; spamFlag: boolean; spamScore: number | null },
  blocked: string[],
  threshold: number,
): boolean {
  if (isBlocked(message.fromEmail, blocked)) return true
  // Prefer the spam filter's score (compared to the user's own threshold); fall back to its yes/no flag.
  if (message.spamScore != null) return message.spamScore >= threshold
  return message.spamFlag
}

// ---------- Sync ----------

// Re-reading every flag is costly in big folders. Skip it when the server says nothing changed:
// any flag change or new message raises its change counter (CONDSTORE), and a deletion lowers the
// message count. Servers without CONDSTORE report no counter, so they always get the full check.
export function nothingChanged(
  saved: { highestModseq: bigint | null; lastExists: number | null },
  now: { highestModseq: bigint | null; exists: number },
  newMessages: number,
): boolean {
  return (
    now.highestModseq != null &&
    saved.highestModseq === now.highestModseq &&
    saved.lastExists === now.exists &&
    newMessages === 0
  )
}
