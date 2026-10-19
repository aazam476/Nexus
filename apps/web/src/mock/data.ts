// Demo data for the UI mock. Replaced by real API calls once the server exists.
import type { Account, Contact, Message, Plugin, Rule } from '../types'

export const me = { name: 'Ali Azam', email: 'ali@azam.email' }

export const accounts: Account[] = [
  { id: 'a1', email: 'ali@azam.email', name: 'Personal', color: '#ff7f6e', protocol: 'imap', auth: 'password', unread: 8, role: 'owner' },
  { id: 'a2', email: 'home@fastmail.com', name: 'Household', color: '#4fd1a1', protocol: 'imap', auth: 'password', unread: 3, role: 'owner' },
  { id: 'a3', email: 'ali.azam@outlook.com', name: 'Work', color: '#6ea8ff', protocol: 'imap', auth: 'oauth-microsoft', unread: 1, role: 'editor' },
]

const today = (h: number, m: number) => {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}
const daysAgo = (n: number, h = 9) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(h, 12, 0, 0)
  return d.toISOString()
}

const sara = { name: 'Sara Okafor', email: 'sara@okafor.dev' }

export const messages: Message[] = [
  {
    id: 'm1', accountId: 'a1', folder: 'inbox', category: 'people', from: sara, to: [me],
    subject: 'Re: Paperless tags for the tax folder',
    preview: 'I tried your rule set and it caught everything except the 2024 Hetzner invoices…',
    html: `<p>Hi Ali,</p><p>I tried your rule set and it caught everything except the <b>2024 Hetzner invoices</b>. They come from a different sender address now, so I added a second rule and re-ran the import.</p><p>Also, are we still on for the flight on the 14th? I put the booking in the shared calendar.</p><p>Sara</p>`,
    date: today(10, 4), unread: true, starred: false, labels: ['Homelab'], security: 'pgp-signed',
    attachments: [
      { id: 'f1', filename: 'tax-rules.png', contentType: 'image/png', size: 212_000 },
      { id: 'f2', filename: 'hetzner-2024.pdf', contentType: 'application/pdf', size: 1_400_000 },
    ],
  },
  {
    id: 'm2', accountId: 'a2', folder: 'inbox', category: 'people', from: { name: 'Mum', email: 'farah.azam@gmail.com' }, to: [{ name: 'Household', email: 'home@fastmail.com' }],
    subject: 'Photos from the garden',
    preview: 'The roses came back after all. Can you put these on the photo server so Dad can see…',
    html: `<p>The roses came back after all! Can you put these on the photo server so Dad can see them on the TV?</p><p>Love, Mum</p>`,
    date: today(9, 51), unread: true, starred: true, labels: [],
    attachments: [
      { id: 'f3', filename: 'IMG_4410.jpg', contentType: 'image/jpeg', size: 3_200_000 },
      { id: 'f4', filename: 'IMG_4411.jpg', contentType: 'image/jpeg', size: 2_900_000 },
      { id: 'f5', filename: 'IMG_4415.jpg', contentType: 'image/jpeg', size: 3_400_000 },
    ],
  },
  {
    id: 'm3', accountId: 'a1', folder: 'inbox', category: 'travel', from: { name: 'KLM Royal Dutch Airlines', email: 'noreply@klm.com' }, to: [me],
    subject: 'Booking confirmed AMS → SFO, 14 Nov',
    preview: 'Your e-ticket KL605 is attached. Check-in opens 30 hours before departure.',
    html: `<table width="100%" style="background:#00a1de;color:#fff;padding:24px;font-family:Arial"><tr><td><h1 style="margin:0">Your trip to San Francisco</h1><p>Booking code <b>QX7T2M</b></p></td></tr></table><p style="font-family:Arial">Dear Mr Azam, your booking is confirmed. Your e-ticket is attached.</p><img src="https://img.klm.com/banner.png" alt="KLM" width="600">`,
    date: today(8, 15), unread: true, starred: false, labels: ['Travel'], hasRemoteImages: true,
    event: { title: 'KL605 Amsterdam → San Francisco', start: '2026-11-14T10:25:00+01:00', end: '2026-11-14T12:40:00-08:00', location: 'AMS Schiphol, Terminal 2', detail: 'Seat 32A · Booking QX7T2M' },
    attachments: [{ id: 'f6', filename: 'e-ticket-KL605.pdf', contentType: 'application/pdf', size: 184_000 }],
  },
  {
    id: 'm4', accountId: 'a2', folder: 'inbox', category: 'people', from: { name: 'Tom Brandt', email: 'tom@brandt.house' }, to: [{ name: 'Household', email: 'home@fastmail.com' }],
    subject: 'Saturday plans?',
    preview: 'Climbing at 10, then lunch? Let me know by Thursday so I can book the wall.',
    text: 'Climbing at 10, then lunch? Let me know by Thursday so I can book the wall.\n\nTom',
    date: daysAgo(2), unread: false, starred: false, labels: [], attachments: [],
  },
  {
    id: 'm5', accountId: 'a3', folder: 'inbox', category: 'people', from: { name: 'Priya Natarajan', email: 'priya@contoso.com' }, to: [{ name: 'Ali Azam', email: 'ali.azam@outlook.com' }],
    subject: 'Q4 infra budget, encrypted',
    preview: 'Encrypted message',
    date: daysAgo(1, 16), unread: true, starred: false, labels: [], security: 'pgp-encrypted', attachments: [],
  },
  {
    id: 'm6', accountId: 'a1', folder: 'inbox', category: 'notifications', from: { name: 'Immich', email: 'noreply@photos.azam.home' }, to: [me],
    subject: 'Your Sunday backup finished: 1,284 new photos',
    preview: 'Library size is now 412 GB. 3 files were skipped because they were still being written.',
    html: '<p>The weekly backup job on <b>photos.azam.home</b> completed in 41 minutes. Library size is now 412 GB across 3 users.</p><p>3 files were skipped because they were still being written.</p>',
    date: today(7, 2), unread: true, starred: false, labels: ['Homelab'],
    attachments: [{ id: 'f7', filename: 'backup-2026-10-19.log', contentType: 'text/plain', size: 84_000 }],
  },
  {
    id: 'm7', accountId: 'a1', folder: 'inbox', category: 'notifications', from: { name: 'GitHub', email: 'notifications@github.com' }, to: [me],
    subject: '[nexus] PR #14 ready for review: POP3 fetcher',
    preview: 'jdoe requested your review on fetch-pop3.ts',
    text: 'jdoe requested your review on this pull request.\n\nhttps://github.com/aliazam/nexus/pull/14',
    date: daysAgo(1, 18), unread: true, starred: false, labels: [], attachments: [],
  },
  {
    id: 'm8', accountId: 'a2', folder: 'inbox', category: 'notifications', from: { name: 'Nextcloud', email: 'admin@cloud.azam.home' }, to: [{ name: 'Household', email: 'home@fastmail.com' }],
    subject: 'Storage at 81%',
    preview: 'Your instance cloud.azam.home is running low on space.',
    text: 'Your instance cloud.azam.home is running low on space. 81% of 2 TB used.',
    date: daysAgo(3), unread: false, starred: false, labels: ['Homelab'], attachments: [],
  },
  {
    id: 'm9', accountId: 'a1', folder: 'inbox', category: 'notifications', from: { name: 'Hetzner Online', email: 'billing@hetzner.com' }, to: [me],
    subject: 'Invoice R0034871 for October',
    preview: 'Amount due €14.28, paid by SEPA direct debit.',
    text: 'Amount due €14.28, paid by SEPA direct debit.',
    date: daysAgo(4), unread: false, starred: false, labels: ['Receipts'],
    attachments: [{ id: 'f8', filename: 'R0034871.pdf', contentType: 'application/pdf', size: 92_000 }],
  },
  {
    id: 'm10', accountId: 'a1', folder: 'inbox', category: 'newsletters', from: { name: 'selfh.st', email: 'newsletter@selfh.st' }, to: [me],
    subject: 'This week in self-hosting: 18 new releases',
    preview: 'Immich 2.4, Paperless-ngx 2.18, and a new Nextcloud Hub. Plus a reader setup…',
    html: '<h2>This week in self-hosting</h2><p>Immich 2.4, Paperless-ngx 2.18 and a new Nextcloud Hub.</p>',
    date: daysAgo(1, 7), unread: true, starred: false, labels: [], attachments: [],
  },
  {
    id: 'm11', accountId: 'a3', folder: 'inbox', category: 'newsletters', from: { name: 'LWN.net', email: 'lwn@lwn.net' }, to: [{ name: 'Ali Azam', email: 'ali.azam@outlook.com' }],
    subject: 'LWN.net Weekly Edition for October 16',
    preview: 'Kernel 6.18 released, the state of Rust in the kernel, and more.',
    text: 'Kernel 6.18 released, the state of Rust in the kernel, and more.',
    date: daysAgo(3, 6), unread: false, starred: false, labels: [], attachments: [],
  },
  {
    id: 'm12', accountId: 'a1', folder: 'scheduled', category: 'people', from: me, to: [{ name: 'Hosting group', email: 'hosting@azam.email' }],
    subject: 'Quarterly hosting costs',
    preview: 'Draft attached for review before Monday.',
    text: 'Hi all, the quarterly hosting costs are attached. Total €128.40.',
    date: today(6, 0), scheduledFor: (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return d.toISOString() })(),
    unread: false, starred: false, labels: [], attachments: [{ id: 'f9', filename: 'hosting-q3.xlsx', contentType: 'application/vnd.ms-excel', size: 24_000 }],
  },
  {
    id: 'm13', accountId: 'a1', folder: 'sent', category: 'people', from: me, to: [sara],
    subject: 'Paperless tags for the tax folder',
    preview: 'Here is the rule set I use, try it on your instance.',
    text: 'Here is the rule set I use, try it on your instance.', date: daysAgo(1, 20), unread: false, starred: false, labels: [], attachments: [],
  },
  {
    id: 'm14', accountId: 'a1', folder: 'spam', category: 'notifications', from: { name: 'Crypto Winner', email: 'win@claim-prize.biz' }, to: [me],
    subject: 'You have won 2.5 BTC, claim now',
    preview: 'Click the link to claim your prize before it expires.',
    text: 'Click the link to claim your prize before it expires.', date: daysAgo(1, 3), unread: true, starred: false, labels: [], attachments: [],
  },
]

export const contacts: Contact[] = [
  { id: 'c1', name: 'Sara Okafor', emails: ['sara@okafor.dev'], company: 'Okafor Labs', pgpKey: { fingerprint: '3A1F 9C22 7B0E 44D1 8E6A  0F3C 91B2 D7E4 55A8 1C09', created: '2025-02-11' }, messageCount: 48 },
  { id: 'c2', name: 'Tom Brandt', emails: ['tom@brandt.house'], phone: '+49 151 2345 6789', messageCount: 21 },
  { id: 'c3', name: 'Priya Natarajan', emails: ['priya@contoso.com', 'priya.n@proton.me'], company: 'Contoso', pgpKey: { fingerprint: '88C0 1D4E 2A77 B913 06FE  4C21 7D90 AA3B 12E5 6F40', created: '2024-09-30' }, messageCount: 17 },
  { id: 'c4', name: 'Mum', emails: ['farah.azam@gmail.com'], messageCount: 112 },
  { id: 'c5', name: 'Jonas Doe', emails: ['jdoe@users.noreply.github.com'], messageCount: 6 },
]

export const plugins: Plugin[] = [
  {
    id: 'immich', name: 'Immich', description: 'Save photo and video attachments to your Immich library.', author: 'Nexus', builtIn: true, enabled: true,
    capabilities: ['save-attachment'],
    settings: [
      { key: 'url', label: 'Server URL', type: 'url', value: 'https://photos.azam.home', placeholder: 'https://photos.example.com' },
      { key: 'apiKey', label: 'API key', type: 'password', value: '••••••••••••' },
      { key: 'album', label: 'Album (optional)', type: 'text', value: 'From email' },
    ],
  },
  {
    id: 'nextcloud-files', name: 'Nextcloud Files', description: 'Save any attachment to a folder in Nextcloud.', author: 'Nexus', builtIn: true, enabled: true,
    capabilities: ['save-attachment'],
    settings: [
      { key: 'url', label: 'Server URL', type: 'url', value: 'https://cloud.azam.home', placeholder: 'https://cloud.example.com' },
      { key: 'username', label: 'Username', type: 'text', value: 'ali' },
      { key: 'appPassword', label: 'App password', type: 'password', value: '••••••••••••' },
      { key: 'folder', label: 'Folder', type: 'text', value: '/Email attachments' },
    ],
  },
  {
    id: 'nextcloud-calendar', name: 'Nextcloud Calendar', description: 'Add flights, bookings and invites found in email to a Nextcloud calendar.', author: 'Nexus', builtIn: true, enabled: true,
    capabilities: ['create-event'],
    settings: [
      { key: 'url', label: 'Server URL', type: 'url', value: 'https://cloud.azam.home', placeholder: 'https://cloud.example.com' },
      { key: 'username', label: 'Username', type: 'text', value: 'ali' },
      { key: 'appPassword', label: 'App password', type: 'password', value: '••••••••••••' },
      { key: 'calendar', label: 'Calendar', type: 'text', value: 'personal' },
    ],
  },
  {
    id: 'paperless', name: 'Paperless-ngx', description: 'Send PDFs and scans straight to Paperless for OCR and filing.', author: 'Nexus', builtIn: true, enabled: false,
    capabilities: ['save-attachment'],
    settings: [
      { key: 'url', label: 'Server URL', type: 'url', value: '', placeholder: 'https://paperless.example.com' },
      { key: 'token', label: 'API token', type: 'password', value: '' },
    ],
  },
]

export const rules: Rule[] = [
  { id: 'r1', name: 'Invoices to Receipts', when: { field: 'subject', contains: 'invoice' }, then: { action: 'label', value: 'Receipts' }, enabled: true },
  { id: 'r2', name: 'Homelab alerts', when: { field: 'from', contains: '.azam.home' }, then: { action: 'label', value: 'Homelab' }, enabled: true },
  { id: 'r3', name: 'GitHub is a notification', when: { field: 'from', contains: 'github.com' }, then: { action: 'category', value: 'notifications' }, enabled: true },
]

export const blockedSenders = ['claim-prize.biz', 'promo@spammy.example']

export const labels = [
  { name: 'Homelab', color: '#4fd1a1' },
  { name: 'Receipts', color: '#f5b544' },
  { name: 'Travel', color: '#c79bff' },
]
