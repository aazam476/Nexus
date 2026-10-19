// Decides where a new message goes: its smart-inbox category, labels, and whether it is spam.
// Pure functions, so they are easy to test and reason about.

export type Category = 'people' | 'travel' | 'notifications' | 'newsletters'

interface Classifiable {
  fromEmail: string
  subject: string
  isMailingList: boolean
  isAutomated: boolean
  hasEvent: boolean
}

const automatedSender = /^(no-?reply|do-?not-?reply|notifications?|notify|alerts?|mailer-daemon|postmaster|bounces?|billing|invoices?|receipts?|accounts?|security|admin|system)([+.\-_@]|$)/i
const travelSubject = /\b(booking|itinerary|boarding pass|e-?ticket|flight|check-?in|reservation|your trip)\b/i

export function classify(message: Classifiable): Category {
  if (message.hasEvent || travelSubject.test(message.subject)) return 'travel'
  if (message.isAutomated || automatedSender.test(message.fromEmail) || message.fromEmail.includes('noreply')) return 'notifications'
  if (message.isMailingList) return 'newsletters'
  return 'people'
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
    const haystack = {
      from: `${message.fromName} ${message.fromEmail}`,
      to: message.to.join(' '),
      subject: message.subject,
      body: message.text,
    }[rule.field] ?? ''
    if (!haystack.toLowerCase().includes(rule.contains.toLowerCase())) continue

    if (rule.action === 'label' && rule.value) outcome.labels.push(rule.value)
    if (rule.action === 'move' && rule.value) outcome.moveTo = rule.value
    if (rule.action === 'category' && rule.value) outcome.category = rule.value as Category
    if (rule.action === 'mark-read') outcome.markRead = true
    if (rule.action === 'spam') outcome.spam = true
  }
  return outcome
}

// ---------- Spam ----------

// "spam@example.com" blocks one address; "example.com" blocks the domain and its subdomains.
export function isBlocked(fromEmail: string, patterns: string[]): boolean {
  const email = fromEmail.toLowerCase()
  const domain = email.split('@')[1] ?? ''
  return patterns.some((raw) => {
    const pattern = raw.toLowerCase().replace(/^@/, '')
    return pattern.includes('@') ? email === pattern : domain === pattern || domain.endsWith(`.${pattern}`)
  })
}

export function isSpam(message: { fromEmail: string; spamFlag: boolean; spamScore: number | null }, blocked: string[], threshold: number): boolean {
  if (isBlocked(message.fromEmail, blocked)) return true
  if (message.spamScore != null) return message.spamScore >= threshold
  return message.spamFlag
}
