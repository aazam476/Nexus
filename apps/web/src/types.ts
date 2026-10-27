// Shapes the web app works with. These match what the server's API returns.

export type Category = 'people' | 'travel' | 'notifications' | 'newsletters'

export type FolderRole = 'inbox' | 'starred' | 'scheduled' | 'drafts' | 'sent' | 'archive' | 'spam' | 'trash'

export interface Account {
  id: string
  email: string
  name: string
  color: string
  protocol: 'imap' | 'pop3'
  auth: 'password' | 'oauth-google' | 'oauth-microsoft'
  role: 'owner' | 'editor' | 'viewer'
  signature: string // HTML
  lastSyncAt: string | null
  syncError: string | null
  // Server settings, only sent to the account's owner.
  inHost?: string
  inPort?: number
  inTls?: boolean
  smtpHost?: string
  smtpPort?: number
  smtpTls?: boolean
  username?: string
}

export interface Person {
  name: string
  email: string
}

export interface Attachment {
  id: string
  filename: string
  contentType: string
  size: number
}

export interface CalendarEvent {
  title: string
  start: string
  end: string
  location?: string
  detail?: string
}

export interface Message {
  id: string
  accountId: string
  folder: FolderRole
  category: Category
  from: Person
  to: Person[]
  cc: Person[]
  subject: string
  preview: string
  date: string
  unread: boolean
  starred: boolean
  labels: string[]
  attachments: Attachment[]
  event?: CalendarEvent | null
  security?: 'pgp-encrypted' | 'pgp-signed' | 'smime-signed' | 'smime-encrypted' | null
  // Only on the full message (GET /messages/:id):
  messageId?: string | null
  html?: string | null
  text?: string | null
  signature?: 'trusted' | 'untrusted' | 'invalid' // S/MIME signature check
  // Only on drafts and scheduled mail written in Nexus:
  outgoing?: boolean
  scheduledFor?: string | null
  forwardOf?: string
  error?: string | null
}

export interface Contact {
  id: string
  name: string
  emails: string[]
  phone?: string | null
  company?: string | null
  pgpPublicKey?: string | null
  pgpFingerprint?: string | null
  messageCount: number
}

export interface Plugin {
  id: string
  name: string
  description: string
  author: string
  builtIn: boolean
  enabled: boolean
  capabilities: ('save-attachment' | 'create-event')[]
  settings: {
    key: string
    label: string
    type: 'text' | 'password' | 'url'
    value: string
    placeholder?: string
    required?: boolean
  }[]
}

export interface Rule {
  id: string
  name: string
  field: 'from' | 'to' | 'subject' | 'body'
  contains: string
  action: 'label' | 'move' | 'category' | 'mark-read' | 'spam'
  value?: string | null
  enabled: boolean
}

// ---------- Feeds (RSS and Atom) ----------

export interface Feed {
  id: string
  url: string
  title: string
  siteUrl: string | null
  lastFetchedAt: string | null
  error: string | null // why the last check failed
  unread: number
}

export interface FeedItem {
  id: string
  feedId: string
  feedTitle: string
  title: string
  link: string | null
  author: string | null
  summary: string
  content?: string // only when one post is loaded
  publishedAt: string
  unread: boolean
  starred: boolean
}
