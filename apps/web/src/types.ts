// Shapes the web app works with. The server API will return these same shapes.

export type Category = 'people' | 'travel' | 'notifications' | 'newsletters'

export type FolderRole = 'inbox' | 'starred' | 'scheduled' | 'drafts' | 'sent' | 'archive' | 'spam' | 'trash'

export interface Account {
  id: string
  email: string
  name: string
  color: string
  protocol: 'imap' | 'pop3'
  auth: 'password' | 'oauth-google' | 'oauth-microsoft'
  unread: number
  role: 'owner' | 'editor' | 'viewer'
  signature: string // HTML; plain-text mode converts it
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
  cc?: Person[]
  subject: string
  preview: string
  html?: string
  text?: string
  date: string
  unread: boolean
  starred: boolean
  labels: string[]
  attachments: Attachment[]
  event?: CalendarEvent
  security?: 'pgp-encrypted' | 'pgp-signed' | 'smime-signed' | 'smime-encrypted'
  scheduledFor?: string
  hasRemoteImages?: boolean
}

export interface Contact {
  id: string
  name: string
  emails: string[]
  phone?: string
  company?: string
  pgpKey?: { fingerprint: string; created: string }
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
  settings: { key: string; label: string; type: 'text' | 'password' | 'url'; value: string; placeholder?: string }[]
}

export interface Rule {
  id: string
  name: string
  when: { field: 'from' | 'to' | 'subject' | 'body'; contains: string }
  then: { action: 'label' | 'move' | 'category' | 'mark-read' | 'spam'; value?: string }
  enabled: boolean
}
