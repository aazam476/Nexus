// Mail from end to end: syncing from the GreenMail test server (IMAP and POP3), sorting, reading,
// attachments, flags, moving, spam, deleting and search. Changes are checked on the mail server too,
// because other mail apps must see the same thing Nexus shows.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../db.ts'
import { Pop3 } from '../accounts/pop3.ts'
import {
  Browser,
  PASSWORD,
  addAccount,
  deliver,
  onMailServer,
  signedInUser,
  startApp,
  subjectsOnServer,
  uniqueAddress,
  waitFor,
} from '../../test/helpers.ts'
import { syncAccount, syncLimits } from './sync.ts'

// The smallest valid PNG: one transparent pixel.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const flight = {
  '@context': 'http://schema.org',
  '@type': 'FlightReservation',
  reservationNumber: 'ABC123',
  reservationFor: {
    '@type': 'Flight',
    flightNumber: '42',
    airline: { iataCode: 'NX' },
    departureAirport: { name: 'Oslo', iataCode: 'OSL' },
    arrivalAirport: { name: 'Lisbon', iataCode: 'LIS' },
    departureTime: '2030-05-01T08:00:00Z',
    arrivalTime: '2030-05-01T12:00:00Z',
  },
}

interface Row {
  id: string
  subject: string
  folder: string
  category: string
  unread: boolean
  starred: boolean
  labels: string[]
  preview: string
  attachments: { id: string; filename: string }[]
}

let app: Awaited<ReturnType<typeof startApp>>
beforeAll(async () => {
  app = await startApp()
})
afterAll(() => app.close())

// A signed-in user whose new IMAP mailbox has received `mails`, synced into Nexus.
async function mailboxWith(mails: Parameters<typeof deliver>[1][], setup?: (browser: Browser) => Promise<void>) {
  const { browser, user } = await signedInUser(app)
  const { id: accountId, email } = await addAccount(browser)
  await setup?.(browser)
  for (const mail of mails) await deliver(email, mail)
  await syncAccount(accountId)
  const list = async (query = 'folder=inbox') => browser.json<Row[]>('GET', `/api/messages?${query}`)
  const find = async (subject: string, query?: string) => (await list(query)).find((m) => m.subject === subject)!
  return { browser, user, accountId, email, list, find }
}

describe('IMAP sync', () => {
  it('downloads new mail and sorts it into people, newsletters and notifications', async () => {
    const { list } = await mailboxWith([
      { from: 'Jane Doe <jane@example.test>', subject: 'Lunch?', text: 'Tomorrow at noon?' },
      {
        from: 'Weekly <news@letters.test>',
        subject: 'Issue 7',
        html: '<p>News</p>',
        headers: { 'List-Unsubscribe': '<mailto:u@letters.test>' },
      },
      {
        from: 'Builds <noreply@ci.test>',
        subject: 'Build passed',
        text: 'All green',
        headers: { 'Auto-Submitted': 'auto-generated' },
      },
    ])
    const rows = await list()
    expect(rows.map((r) => [r.subject, r.category, r.unread]).sort()).toEqual([
      ['Build passed', 'notifications', true],
      ['Issue 7', 'newsletters', true],
      ['Lunch?', 'people', true],
    ])
  })

  it('mirrors read state and deletions made in other mail apps', async () => {
    const { accountId, email, list } = await mailboxWith(
      [1, 2, 3].map((n) => ({ subject: `Message ${n}`, text: `Body ${n}` })),
    )
    const before = await db.message.findMany({ where: { accountId }, orderBy: { subject: 'asc' } })

    await onMailServer(email, async (client) => {
      const lock = await client.getMailboxLock('INBOX')
      try {
        await client.messageFlagsAdd(String(before[0].uid), ['\\Seen'], { uid: true })
        await client.messageDelete(String(before[1].uid), { uid: true })
      } finally {
        lock.release()
      }
    })
    await syncAccount(accountId)
    expect((await list()).map((r) => [r.subject, r.unread]).sort()).toEqual([
      ['Message 1', false],
      ['Message 3', true],
    ])
  })

  it('does not download anything twice', async () => {
    const { accountId } = await mailboxWith([{ subject: 'Once', text: 'x' }])
    await syncAccount(accountId)
    await syncAccount(accountId)
    expect(await db.message.count({ where: { accountId } })).toBe(1)
  })

  it('records why a sync failed, and clears it once it works again', async () => {
    const { accountId } = await mailboxWith([])
    await db.account.update({ where: { id: accountId }, data: { inPort: 1 } })
    await expect(syncAccount(accountId)).rejects.toThrow()
    expect((await db.account.findUniqueOrThrow({ where: { id: accountId } })).syncError).toMatch(/ECONNREFUSED/)

    await db.account.update({ where: { id: accountId }, data: { inPort: 3993 } })
    await syncAccount(accountId)
    const account = await db.account.findUniqueOrThrow({ where: { id: accountId } })
    expect(account.syncError).toBeNull()
    expect(account.lastSyncAt).not.toBeNull()
  })
})

describe('older mail', () => {
  it('downloads the newest mail first, then the rest a batch per sync, without re-sorting it', async () => {
    const saved = { ...syncLimits }
    Object.assign(syncLimits, { firstSync: 3, historyBatch: 2 }) // small numbers, to see each step
    try {
      const { browser } = await signedInUser(app)
      const { id: accountId, email } = await addAccount(browser)
      // An old message from a sender blocked later: history isn't put through today's spam rules.
      await deliver(email, { from: 'Pest <pest@annoying.test>', subject: 'Old 1', text: 'x' })
      for (const n of [2, 3, 4, 5, 6, 7]) await deliver(email, { subject: `Old ${n}`, text: 'x' })
      await browser.json('POST', '/api/blocked', { pattern: 'annoying.test' })
      const stored = async () =>
        (await db.message.findMany({ where: { accountId }, orderBy: { subject: 'asc' } })).map((m) => m.subject)

      await syncAccount(accountId) // newest 3, then 2 older
      expect(await stored()).toEqual(['Old 3', 'Old 4', 'Old 5', 'Old 6', 'Old 7'])
      await syncAccount(accountId) // the last 2
      expect(await stored()).toEqual(['Old 1', 'Old 2', 'Old 3', 'Old 4', 'Old 5', 'Old 6', 'Old 7'])
      await syncAccount(accountId) // nothing left, nothing twice
      expect(await db.message.count({ where: { accountId } })).toBe(7)

      const inbox = await browser.json<Row[]>('GET', '/api/messages?folder=inbox')
      expect(inbox.map((r) => r.subject)).toContain('Old 1') // still in the inbox, not moved to spam
      const folder = await db.folder.findFirstOrThrow({ where: { accountId, role: 'inbox' } })
      expect(folder.oldestUid).toBe(1) // history complete
    } finally {
      Object.assign(syncLimits, saved)
    }
  })
})

describe('sorting rules and spam', () => {
  it('applies your rules and blocked senders, and moves spam on the server too', async () => {
    const { email, list } = await mailboxWith(
      [
        { from: 'Shop <billing@shop.test>', subject: 'Invoice 55', text: 'Total 10' },
        { from: 'Pest <pest@annoying.test>', subject: 'Buy now', text: 'x' },
        { from: 'Bot <bot@spam.test>', subject: 'You won', text: 'x', headers: { 'X-Spam-Flag': 'YES' } },
      ],
      async (browser) => {
        await browser.json('POST', '/api/rules', {
          name: 'Invoices',
          field: 'subject',
          contains: 'invoice',
          action: 'label',
          value: 'Receipts',
        })
        await browser.json('POST', '/api/blocked', { pattern: 'annoying.test' })
      },
    )
    expect((await list()).map((r) => [r.subject, r.labels])).toEqual([['Invoice 55', ['Receipts']]])
    expect((await list('folder=spam')).map((r) => r.subject).sort()).toEqual(['Buy now', 'You won'])
    expect((await subjectsOnServer(email, 'Junk')).sort()).toEqual(['Buy now', 'You won'])
  })
})

describe('reading mail', () => {
  it('shows the full message, its attachments and the calendar event inside', async () => {
    const { browser, find } = await mailboxWith([
      {
        subject: 'Your trip',
        html: `<script type="application/ld+json">${JSON.stringify(flight)}</script><p>Have a <b>good</b> flight</p>`,
        attachments: [
          { filename: 'boarding.png', content: PNG, contentType: 'image/png' },
          { filename: 'notes.txt', content: 'Gate B12' },
        ],
      },
    ])
    const row = await find('Your trip')
    expect(row.attachments.map((a) => a.filename)).toEqual(['boarding.png', 'notes.txt'])

    const detail = await browser.json('GET', `/api/messages/${row.id}`)
    expect(detail.html).toContain('<b>good</b>')
    expect(detail.event).toMatchObject({
      title: 'NX42 Oslo → Lisbon',
      start: '2030-05-01T08:00:00Z',
      detail: 'Booking ABC123',
    })

    // Images open inline in the preview; asking for a download makes it a download.
    const image = await browser.get(`/api/messages/${row.id}/attachments/${row.attachments[0].id}`)
    expect(image.headers['content-type']).toBe('image/png')
    expect(image.headers['content-disposition']).toMatch(/^inline; filename="boarding.png"/)
    expect(image.headers['content-security-policy']).toMatch(/^sandbox/)
    expect(Buffer.compare(image.rawPayload, PNG)).toBe(0)
    const download = await browser.get(`/api/messages/${row.id}/attachments/${row.attachments[0].id}?download`)
    expect(download.headers['content-disposition']).toMatch(/^attachment;/)
    expect((await browser.get(`/api/messages/${row.id}/attachments/99`)).statusCode).toBe(404)

    const ics = await browser.get(`/api/messages/${row.id}/event.ics`)
    expect(ics.body).toContain('BEGIN:VEVENT')
    expect(ics.body).toContain('DTSTART:20300501T080000Z')

    const raw = await browser.get(`/api/messages/${row.id}/raw`)
    expect(raw.headers['content-type']).toBe('message/rfc822')
    expect(raw.body).toContain('Subject: Your trip')
  })

  it('counts unread mail per folder and per account for the sidebar', async () => {
    const { browser, accountId } = await mailboxWith([
      { subject: 'A', text: 'a' },
      { subject: 'B', text: 'b' },
    ])
    const counts = await browser.json('GET', '/api/counts')
    expect(counts.folders.inbox).toBe(2)
    expect(counts.accounts[accountId]).toBe(2)
  })

  it('finds mail by words in the body, across folders, and filters by label', async () => {
    const { browser, find, list } = await mailboxWith([
      { subject: 'Plans', text: 'Let us meet at the aquarium' },
      { subject: 'Other', text: 'Nothing here' },
    ])
    expect((await list('q=aquarium')).map((r) => r.subject)).toEqual(['Plans'])
    const plans = await find('Plans')
    await browser.json('POST', `/api/messages/${plans.id}/move`, { to: 'archive' })
    expect((await list('q=aquarium')).map((r) => r.subject)).toEqual(['Plans'])

    await db.message.update({ where: { id: plans.id }, data: { labels: ['Trips'] } })
    expect((await list('folder=archive&label=Trips')).map((r) => r.subject)).toEqual(['Plans'])
    expect(await list('folder=inbox&label=Trips')).toEqual([])
  })

  it('returns only as many messages as asked for, newest first', async () => {
    const { list } = await mailboxWith(
      [1, 2, 3].map((n) => ({ subject: `N${n}`, text: 'x', date: new Date(2030, 0, n) })),
    )
    expect((await list('folder=inbox&limit=2')).map((r) => r.subject)).toEqual(['N3', 'N2'])
    expect(await list('limit=0').catch((e) => e.message)).toMatch(/400/)
  })
})

describe('organising mail', () => {
  it('marks read and starred on the server too', async () => {
    const { browser, email, find, list } = await mailboxWith([{ subject: 'Flag me', text: 'x' }])
    const row = await find('Flag me')
    await browser.json('PATCH', `/api/messages/${row.id}`, { unread: false, starred: true })

    expect(await find('Flag me')).toMatchObject({ unread: false, starred: true })
    expect((await list('folder=starred')).map((r) => r.subject)).toEqual(['Flag me'])
    const flags = await onMailServer(email, async (client) => {
      await client.mailboxOpen('INBOX')
      const message = await client.fetchOne('*', { flags: true })
      return message ? [...(message.flags ?? [])] : []
    })
    expect(flags).toEqual(expect.arrayContaining(['\\Seen', '\\Flagged']))
  })

  it('archives and brings back, on the server too', async () => {
    const { browser, email, find, list } = await mailboxWith([{ subject: 'Keep', text: 'x' }])
    const row = await find('Keep')
    await browser.json('POST', `/api/messages/${row.id}/move`, { to: 'archive' })
    expect(await list()).toEqual([])
    expect(await subjectsOnServer(email, 'Archive')).toEqual(['Keep'])

    await browser.json('POST', `/api/messages/${row.id}/move`, { to: 'inbox' })
    expect((await list()).map((r) => r.subject)).toEqual(['Keep'])
    expect(await subjectsOnServer(email, 'INBOX')).toEqual(['Keep'])
  })

  it('marking spam blocks the sender; "not spam" unblocks them and returns the mail', async () => {
    const { browser, find, list } = await mailboxWith([
      { from: 'Maybe <maybe@spammy.test>', subject: 'Offer', text: 'x' },
    ])
    const row = await find('Offer')
    await browser.json('POST', `/api/messages/${row.id}/spam`, { spam: true })
    expect((await list('folder=spam')).map((r) => r.subject)).toEqual(['Offer'])
    expect(await browser.json('GET', '/api/blocked')).toEqual(['maybe@spammy.test'])

    await browser.json('POST', `/api/messages/${row.id}/spam`, { spam: false })
    expect((await list()).map((r) => r.subject)).toEqual(['Offer'])
    expect(await browser.json('GET', '/api/blocked')).toEqual([])
  })

  it('deletes to Trash first, then for good, on the server too', async () => {
    const { browser, email, find, list } = await mailboxWith([{ subject: 'Bye', text: 'x' }])
    const row = await find('Bye')
    await browser.json('DELETE', `/api/messages/${row.id}`)
    expect((await list('folder=trash')).map((r) => r.subject)).toEqual(['Bye'])
    expect(await subjectsOnServer(email, 'Trash')).toEqual(['Bye'])

    await browser.json('DELETE', `/api/messages/${row.id}`)
    expect(await list('folder=trash')).toEqual([])
    expect(await subjectsOnServer(email, 'Trash')).toEqual([])
  })

  it('rejects an unknown folder', async () => {
    const { browser, find } = await mailboxWith([{ subject: 'X', text: 'x' }])
    expect((await browser.post(`/api/messages/${(await find('X')).id}/move`, { to: 'nowhere' })).statusCode).toBe(400)
  })
})

describe('POP3', () => {
  it('downloads whole messages, including lines that start with a dot, and only once', async () => {
    const { browser } = await signedInUser(app)
    const { id, email } = await addAccount(browser, uniqueAddress('pop'), 'pop3')
    await deliver(email, { subject: 'Dots', text: 'line one\n.starts with a dot\n..two dots\nlast line' })
    await syncAccount(id)
    await syncAccount(id)
    const stored = await db.message.findMany({ where: { accountId: id } })
    expect(stored).toHaveLength(1)
    expect(stored[0].text).toBe('line one\n.starts with a dot\n..two dots\nlast line')
  })

  it('moves mail between Nexus’s own folders, and deleting for good removes it from the server', async () => {
    const { browser } = await signedInUser(app)
    const { id, email } = await addAccount(browser, uniqueAddress('pop'), 'pop3')
    await deliver(email, { subject: 'Pop me', text: 'x' })
    await syncAccount(id)
    const [row] = await browser.json<Row[]>('GET', '/api/messages')

    await browser.json('POST', `/api/messages/${row.id}/move`, { to: 'archive' })
    expect((await browser.json<Row[]>('GET', '/api/messages?folder=archive')).map((r) => r.subject)).toEqual(['Pop me'])
    await browser.json('DELETE', `/api/messages/${row.id}`) // to Trash
    await browser.json('DELETE', `/api/messages/${row.id}`) // for good

    const pop3 = await Pop3.open({
      host: 'localhost',
      port: 3995,
      tls: true,
      user: email,
      password: 'x',
      tlsOptions: { rejectUnauthorized: false },
    })
    expect(await pop3.uidl()).toEqual([])
    await pop3.quit()
  })
})

describe('private storage', () => {
  it('seals stored mail, opens it after sign-in and a password change, and unseals when turned off', async () => {
    const { browser, user, accountId, find } = await mailboxWith([{ subject: 'Diary', text: 'Dear diary' }])
    const { id: messageId } = await find('Diary')
    const signIn = async (password: string) => {
      const device = new Browser(app)
      await device.json('POST', '/api/auth/login', { email: user.email, password })
      return device
    }
    const read = (device: Browser) => device.get(`/api/messages/${messageId}`)

    const phone = await signIn(PASSWORD)
    await browser.json('POST', '/api/auth/private-storage', { enabled: true, password: PASSWORD })
    // Turning it on answers at once; the account's next sync (queued by it) seals the stored mail.
    expect((await db.message.findUniqueOrThrow({ where: { id: messageId } })).sealedBody).toBeNull()
    await syncAccount(accountId)
    const stored = await db.message.findUniqueOrThrow({ where: { id: messageId } })
    expect(stored.sealedBody).not.toBeNull()
    expect([stored.text, stored.html, stored.preview, stored.raw.length]).toEqual([null, null, '', 0])

    expect((await read(browser)).json().text).toBe('Dear diary')
    expect((await read(phone)).statusCode).toBe(401) // other devices are signed out, so they sign in again and get the key

    // New mail is sealed as it arrives.
    await deliver((await db.account.findUniqueOrThrow({ where: { id: accountId } })).email, {
      subject: 'Later',
      text: 'Also private',
    })
    await syncAccount(accountId)
    const later = await db.message.findFirstOrThrow({ where: { accountId, subject: 'Later' } })
    expect(later.text).toBeNull()
    expect((await browser.json('GET', `/api/messages/${later.id}`)).text).toBe('Also private')

    await browser.json('POST', '/api/auth/password', { current: PASSWORD, next: 'second password 2' })
    const again = await signIn('second password 2')
    expect((await read(again)).json().text).toBe('Dear diary')

    await again.json('POST', '/api/auth/private-storage', { enabled: false, password: 'second password 2' })
    // Opening the mail again happens in the background, right after the answer.
    const unsealed = await waitFor(async () => {
      const message = await db.message.findUniqueOrThrow({ where: { id: messageId } })
      return message.sealedBody === null && message
    }, 'the mail to be unsealed')
    expect(unsealed.text).toBe('Dear diary')
  })

  it('seals even when the mail server is down', async () => {
    const { browser, accountId, find } = await mailboxWith([{ subject: 'Offline', text: 'x' }])
    const { id } = await find('Offline')
    await browser.json('POST', '/api/auth/private-storage', { enabled: true, password: PASSWORD })
    await db.account.update({ where: { id: accountId }, data: { inPort: 1 } })
    await expect(syncAccount(accountId)).rejects.toThrow() // the sync fails…
    expect((await db.message.findUniqueOrThrow({ where: { id } })).sealedBody).not.toBeNull() // …but sealing happened
  })

  it('finishes opening mail at the next sign-in if a restart cut it short', async () => {
    const { browser, user, accountId, find } = await mailboxWith([{ subject: 'Half', text: 'x' }])
    const { id } = await find('Half')
    await browser.json('POST', '/api/auth/private-storage', { enabled: true, password: PASSWORD })
    await syncAccount(accountId)
    // Turned off, but pretend Nexus restarted before the mail was opened: still sealed, setting off.
    await db.user.update({ where: { id: user.id }, data: { privateStorage: false } })
    expect((await db.message.findUniqueOrThrow({ where: { id } })).sealedBody).not.toBeNull()

    await new Browser(app).json('POST', '/api/auth/login', { email: user.email, password: PASSWORD })
    await waitFor(
      async () => (await db.message.findUniqueOrThrow({ where: { id } })).sealedBody === null,
      'the mail to be unsealed',
    )
  })

  it('survives an admin password reset by downloading the mail again', async () => {
    const { browser, user, accountId } = await mailboxWith([{ subject: 'Forgotten', text: 'Still here' }])
    const stored = () => db.message.findFirstOrThrow({ where: { accountId, subject: 'Forgotten' } })
    await browser.json('POST', '/api/auth/private-storage', { enabled: true, password: PASSWORD })
    await syncAccount(accountId)
    expect((await stored()).sealedBody).not.toBeNull()

    const admin = await signedInUser(app, { role: 'admin' })
    const reset = await admin.browser.json('POST', `/api/users/${user.id}/password`, { password: 'a fresh password' })
    expect(reset.redownloading).toBe(1)
    expect((await browser.get('/api/auth/me')).statusCode).toBe(401) // signed out everywhere
    expect(await db.message.count({ where: { accountId } })).toBe(0) // the locked copy is gone…

    await syncAccount(accountId)
    const fresh = await stored() // …and comes back, readable, from the mail server
    expect([fresh.sealedBody, fresh.text?.trim()]).toEqual([null, 'Still here'])
    const me = await new Browser(app).post('/api/auth/login', { email: user.email, password: 'a fresh password' })
    expect(me.statusCode).toBe(200)
  })

  it('is refused for POP3 accounts and shared accounts', async () => {
    const pop = await signedInUser(app)
    await addAccount(pop.browser, uniqueAddress('pop'), 'pop3')
    const refused = await pop.browser.post('/api/auth/private-storage', { enabled: true, password: PASSWORD })
    expect(refused.json().error).toMatch(/POP3 accounts can't use private storage/)

    const owner = await signedInUser(app)
    const friend = await signedInUser(app)
    const { id } = await addAccount(owner.browser)
    await owner.browser.json('PUT', `/api/accounts/${id}/members`, { userId: friend.user.id, role: 'viewer' })
    expect(
      (await owner.browser.post('/api/auth/private-storage', { enabled: true, password: PASSWORD })).json().error,
    ).toMatch(/Stop sharing/)
    expect(
      (await owner.browser.post('/api/auth/private-storage', { enabled: true, password: 'wrong' })).statusCode,
    ).toBe(400)
  })

  it('blocks adding POP3 or sharing while it is on', async () => {
    const { browser } = await signedInUser(app)
    const { id } = await addAccount(browser)
    await browser.json('POST', '/api/auth/private-storage', { enabled: true, password: PASSWORD })
    expect(
      (
        await browser.post('/api/accounts', {
          ...(await import('../../test/helpers.ts')).greenMail(uniqueAddress(), 'pop3'),
        })
      ).statusCode,
    ).toBe(400)
    const friend = await signedInUser(app)
    expect(
      (await browser.put(`/api/accounts/${id}/members`, { userId: friend.user.id, role: 'viewer' })).statusCode,
    ).toBe(400)
  })
})
