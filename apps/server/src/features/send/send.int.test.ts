// Sending mail for real through the GreenMail test server, and checking what arrives:
// recipients, headers, threading, attachments, the copy in Sent, drafts, scheduling and S/MIME.
import { simpleParser } from 'mailparser'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../db.ts'
import { syncAccount } from '../mail/sync.ts'
import { sendScheduled } from './send.ts'
import {
  addAccount,
  makeP12,
  onMailServer,
  signedInUser,
  startApp,
  subjectsOnServer,
  uniqueAddress,
} from '../../test/helpers.ts'

let app: Awaited<ReturnType<typeof startApp>>
beforeAll(async () => {
  app = await startApp()
})
afterAll(() => app.close())

// A signed-in user with one GreenMail account.
async function sender(name = 'Ann Sender') {
  const { browser, user } = await signedInUser(app, { name })
  const { id: accountId, email } = await addAccount(browser)
  return { browser, user, accountId, email }
}

// The raw messages that arrived in a GreenMail mailbox, parsed.
const received = (email: string, folder = 'INBOX') =>
  onMailServer(email, async (client) => {
    const lock = await client.getMailboxLock(folder)
    try {
      if ((client.mailbox as { exists: number }).exists === 0) return []
      const raws: Buffer[] = []
      for await (const message of client.fetch('1:*', { source: true })) if (message.source) raws.push(message.source)
      // skipImageLinks: keep cid: references as sent, instead of inlining the images.
      return Promise.all(raws.map((raw) => simpleParser(raw, { skipImageLinks: true })))
    } finally {
      lock.release()
    }
  })

describe('sending now', () => {
  it('delivers to every recipient, files a copy in Sent, and remembers who you wrote to', async () => {
    const { browser, accountId, email } = await sender()
    const to = uniqueAddress('to')
    const cc = uniqueAddress('cc')
    expect(
      await browser.json('POST', '/api/send', {
        accountId,
        to: [to],
        cc: [cc],
        subject: 'Hello there',
        text: 'Hi!',
        html: '<p>Hi!</p>',
      }),
    ).toEqual({ sent: true })

    const [mail] = await received(to)
    expect(mail.subject).toBe('Hello there')
    expect(mail.from?.text).toBe(`"Ann Sender" <${email}>`)
    expect(mail.html).toContain('<p>Hi!</p>')
    expect(mail.text?.trim()).toBe('Hi!')
    expect((await received(cc)).map((m) => m.subject)).toEqual(['Hello there'])
    expect(await subjectsOnServer(email, 'Sent')).toEqual(['Hello there'])

    const contacts = await browser.json<{ emails: string[] }[]>('GET', '/api/contacts')
    expect(contacts.flatMap((c) => c.emails).sort()).toEqual([cc, to].sort())
  })

  it('sends Bcc-only mail with an "undisclosed recipients" To, and never reveals the Bcc', async () => {
    const { browser, accountId } = await sender()
    const hidden = uniqueAddress('bcc')
    await browser.json('POST', '/api/send', { accountId, bcc: [hidden], subject: 'Quiet', text: 'x' })
    const [mail] = await received(hidden)
    expect(mail.headerLines.find((h) => h.key === 'to')?.line).toMatch(/^To: "?undisclosed-recipients"?:;$/) // an empty group: valid, and shown as "undisclosed recipients"
    expect(mail.headers.has('bcc')).toBe(false)
  })

  it('threads replies with In-Reply-To and References', async () => {
    const { browser, accountId } = await sender()
    const to = uniqueAddress()
    await browser.json('POST', '/api/send', {
      accountId,
      to: [to],
      subject: 'Re: Plans',
      text: 'Sure',
      inReplyTo: '<original@example.test>',
    })
    const [mail] = await received(to)
    expect(mail.inReplyTo).toBe('<original@example.test>')
    expect(mail.references).toBe('<original@example.test>')
  })

  it('turns pasted images into inline attachments, and sends files', async () => {
    const { browser, accountId } = await sender()
    const to = uniqueAddress()
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    )
    await browser.json('POST', '/api/send', {
      accountId,
      to: [to],
      subject: 'Pictures',
      text: 'see image',
      html: `<p>Look</p><img src="data:image/png;base64,${png.toString('base64')}">`,
      attachments: [
        {
          filename: 'report.txt',
          contentType: 'text/plain',
          content: Buffer.from('Quarterly numbers').toString('base64'),
        },
      ],
    })
    const [mail] = await received(to)
    const inline = mail.attachments.find((a) => a.contentType === 'image/png')!
    expect(mail.html).toContain(`cid:${inline.cid}`)
    expect(Buffer.compare(inline.content, png)).toBe(0)
    expect(mail.attachments.find((a) => a.filename === 'report.txt')?.content.toString()).toBe('Quarterly numbers')
  })

  it('forwards a message with its attachments', async () => {
    const { browser, accountId, email } = await sender()
    // A message with an attachment arrives in our own inbox first.
    await browser.json('POST', '/api/send', {
      accountId,
      to: [email],
      subject: 'Original',
      text: 'x',
      attachments: [
        { filename: 'plan.txt', contentType: 'text/plain', content: Buffer.from('The plan').toString('base64') },
      ],
    })
    await syncAccount(accountId)
    const original = (await browser.json<{ id: string; subject: string }[]>('GET', '/api/messages')).find(
      (m) => m.subject === 'Original',
    )!

    const to = uniqueAddress()
    await browser.json('POST', '/api/send', {
      accountId,
      to: [to],
      subject: 'Fwd: Original',
      text: 'FYI',
      forwardOf: original.id,
    })
    const [mail] = await received(to)
    expect(mail.attachments.map((a) => [a.filename, a.content.toString()])).toEqual([['plan.txt', 'The plan']])
  })

  it('explains what is wrong instead of sending', async () => {
    const { browser, accountId } = await sender()
    expect((await browser.post('/api/send', { accountId, subject: 'Nobody', text: 'x' })).json().error).toMatch(
      /at least one recipient/,
    )
    expect((await browser.post('/api/send', { accountId, to: ['not an address'], text: 'x' })).statusCode).toBe(400)

    await db.account.update({ where: { id: accountId }, data: { smtpPort: 1 } })
    const refused = await browser.post('/api/send', { accountId, to: [uniqueAddress()], text: 'x' })
    expect(refused.statusCode).toBe(502)
    expect(refused.json().error).toMatch(/^Your mail server did not accept the message: .*ECONNREFUSED/)
  })
})

describe('drafts', () => {
  it('saves, updates, lists, sends and discards drafts', async () => {
    const { browser, accountId } = await sender()
    const { id } = await browser.json('PUT', '/api/drafts', {
      accountId,
      to: ['half-typed@'],
      subject: 'Draft 1',
      text: 'first',
    })
    expect(
      await browser.json('PUT', '/api/drafts', { id, accountId, to: [], subject: 'Draft 1b', text: 'second' }),
    ).toEqual({ id })

    const drafts = await browser.json<{ id: string; subject: string; text: string; outgoing: boolean }[]>(
      'GET',
      '/api/messages?folder=drafts',
    )
    expect(drafts.map((d) => [d.subject, d.text, d.outgoing])).toEqual([['Draft 1b', 'second', true]])
    expect((await browser.json('GET', `/api/messages/${id}`)).subject).toBe('Draft 1b')
    expect((await browser.json('GET', '/api/counts')).folders.drafts).toBe(1)

    // Sending from a draft removes the draft.
    await browser.json('POST', '/api/send', {
      accountId,
      to: [uniqueAddress()],
      subject: 'Draft 1b',
      text: 'second',
      draftId: id,
    })
    expect(await browser.json('GET', '/api/messages?folder=drafts')).toEqual([])

    const { id: other } = await browser.json('PUT', '/api/drafts', { accountId, subject: 'Throwaway', text: '' })
    await browser.json('DELETE', `/api/outgoing/${other}`)
    expect(await browser.json('GET', '/api/messages?folder=drafts')).toEqual([])
    expect((await browser.delete(`/api/outgoing/${other}`)).statusCode).toBe(404)
  })

  it('saves a draft before any mail account is added', async () => {
    const { browser } = await signedInUser(app)
    const { id } = await browser.json('PUT', '/api/drafts', { to: ['later@example.com'], subject: 'Idea', text: 'x' })
    const drafts = await browser.json<{ id: string }[]>('GET', '/api/messages?folder=drafts')
    expect(drafts.map((d) => d.id)).toEqual([id])
  })

  it('keeps drafts private to their author', async () => {
    const { browser, accountId } = await sender()
    const { id } = await browser.json('PUT', '/api/drafts', { accountId, subject: 'Mine', text: '' })
    const stranger = await signedInUser(app)
    expect((await stranger.browser.get(`/api/messages/${id}`)).statusCode).toBe(404)
    expect((await stranger.browser.delete(`/api/outgoing/${id}`)).statusCode).toBe(404)
  })
})

describe('scheduled send', () => {
  it('holds mail for later, can cancel it, or send it right away', async () => {
    const { browser, accountId } = await sender()
    const later = new Date(Date.now() + 3_600_000).toISOString()
    const to = uniqueAddress()

    const first = await browser.json('POST', '/api/send', {
      accountId,
      to: [to],
      subject: 'Later 1',
      text: 'x',
      scheduledFor: later,
    })
    expect(first).toMatchObject({ scheduled: true })
    const scheduled = await browser.json<{ id: string; subject: string; scheduledFor: string }[]>(
      'GET',
      '/api/messages?folder=scheduled',
    )
    expect(scheduled.map((m) => [m.subject, m.scheduledFor])).toEqual([['Later 1', later]])
    expect(await received(to)).toEqual([])

    await browser.json('DELETE', `/api/outgoing/${first.id}`)
    expect(await browser.json('GET', '/api/messages?folder=scheduled')).toEqual([])

    const second = await browser.json('POST', '/api/send', {
      accountId,
      to: [to],
      subject: 'Later 2',
      text: 'x',
      scheduledFor: later,
    })
    expect(await browser.json('POST', `/api/outgoing/${second.id}/send-now`)).toEqual({ sent: true })
    expect((await received(to)).map((m) => m.subject)).toEqual(['Later 2'])
    expect(await browser.json('GET', '/api/messages?folder=scheduled')).toEqual([])
  })

  it('holds a sent message back for undo, and turns it back into a draft', async () => {
    const { browser, accountId } = await sender()
    const to = uniqueAddress()
    const message = { accountId, to: [to], subject: 'Oops', html: '<p>Wrong attachment</p>', text: 'Wrong attachment' }

    const held = await browser.json<{ id: string; sendsAt: string }>('POST', '/api/send', {
      ...message,
      undoSeconds: 10,
    })
    expect(Date.parse(held.sendsAt) - Date.now()).toBeGreaterThan(8_000)
    expect(await received(to)).toEqual([]) // not sent yet
    expect(await browser.json('GET', '/api/messages?folder=scheduled')).toEqual([]) // as good as sent, so not listed
    expect((await browser.json('GET', '/api/counts')).folders.scheduled).toBe(0)

    const draft = await browser.json('POST', `/api/outgoing/${held.id}/undo`)
    expect(draft).toMatchObject({ id: held.id, to: [to], subject: 'Oops', html: '<p>Wrong attachment</p>' })
    const drafts = await browser.json<{ id: string }[]>('GET', '/api/messages?folder=drafts')
    expect(drafts.map((d) => d.id)).toEqual([held.id])

    // Once the timer is up it goes, and then it's too late to undo.
    const second = await browser.json<{ id: string }>('POST', '/api/send', { ...message, undoSeconds: 5 })
    await sendScheduled(second.id, true) // what the send job does when the timer is up
    expect((await received(to)).map((m) => m.subject)).toEqual(['Oops'])
    expect((await browser.post(`/api/outgoing/${second.id}/undo`)).json().error).toMatch(/Too late/)
  })

  it('sends right away when the chosen time has already passed', async () => {
    const { browser, accountId } = await sender()
    const to = uniqueAddress()
    expect(
      await browser.json('POST', '/api/send', {
        accountId,
        to: [to],
        subject: 'Past',
        text: 'x',
        scheduledFor: new Date(Date.now() - 60_000).toISOString(),
      }),
    ).toEqual({ sent: true })
    expect((await received(to)).map((m) => m.subject)).toEqual(['Past'])
  })
})

describe('S/MIME', () => {
  // Two users with their own certificates. Bea sends Ann a signed message, so Ann learns Bea's certificate.
  async function twoPeopleWithCertificates() {
    const ann = await sender('Ann')
    const bea = await sender('Bea')
    for (const person of [ann, bea]) {
      await person.browser.json('POST', '/api/smime', {
        p12: (await makeP12(person.email, 'p12 password')).toString('base64'),
        password: 'p12 password',
      })
    }
    return { ann, bea }
  }

  it('imports a certificate, and refuses a wrong password or a file without an email address', async () => {
    const { browser, email } = await sender()
    const p12 = (await makeP12(email, 'secret')).toString('base64')
    expect((await browser.post('/api/smime', { p12, password: 'wrong' })).json().error).toMatch(/Check the password/)
    const added = await browser.json('POST', '/api/smime', { p12, password: 'secret' })
    expect(added.email).toBe(email)
    const [listed] = await browser.json('GET', '/api/smime')
    expect(listed).toMatchObject({ email, subject: expect.stringContaining('Test') })
    expect(listed.keyPem).toBeUndefined() // the private key never goes back to the browser

    await browser.json('DELETE', `/api/smime/${listed.id}`)
    expect(await browser.json('GET', '/api/smime')).toEqual([])
  })

  it('signs mail; the receiver sees an intact signature and keeps the certificate', async () => {
    const { ann, bea } = await twoPeopleWithCertificates()
    await bea.browser.json('POST', '/api/send', {
      accountId: bea.accountId,
      to: [ann.email],
      subject: 'Signed hello',
      text: 'It is really me',
      smime: { sign: true, encrypt: false },
    })

    await syncAccount(ann.accountId)
    const [row] = await ann.browser.json<{ id: string; security: string }[]>('GET', '/api/messages')
    expect(row.security).toBe('smime-signed')
    const detail = await ann.browser.json('GET', `/api/messages/${row.id}`)
    expect(detail.signature).toBe('untrusted') // intact, but self-signed rather than from a known authority
    expect(detail.text).toContain('It is really me')
    expect(detail.attachments).toEqual([]) // the smime.p7s signature part isn't shown as a file

    const contact = await db.contact.findFirstOrThrow({ where: { userId: ann.user.id, emails: { has: bea.email } } })
    expect(contact.smimeCert).toContain('BEGIN CERTIFICATE')
  })

  it('encrypts mail that only the recipient can read, and refuses when a certificate is missing', async () => {
    const { ann, bea } = await twoPeopleWithCertificates()
    // Ann can't encrypt to Bea before she has Bea's certificate.
    const tooEarly = await ann.browser.post('/api/send', {
      accountId: ann.accountId,
      to: [bea.email],
      subject: 'x',
      text: 'x',
      smime: { sign: false, encrypt: true },
    })
    expect(tooEarly.json().error).toMatch(/No S\/MIME certificate for/)

    await bea.browser.json('POST', '/api/send', {
      accountId: bea.accountId,
      to: [ann.email],
      subject: 'My certificate',
      text: 'x',
      smime: { sign: true, encrypt: false },
    })
    await syncAccount(ann.accountId)
    const [signed] = await ann.browser.json<{ id: string }[]>('GET', '/api/messages')
    await ann.browser.json('GET', `/api/messages/${signed.id}`) // reading it saves Bea's certificate

    await ann.browser.json('POST', '/api/send', {
      accountId: ann.accountId,
      to: [bea.email],
      subject: 'Secret',
      text: 'The eagle has landed',
      smime: { sign: true, encrypt: true },
    })
    const [onServer] = await received(bea.email)
    expect(onServer.text ?? '').not.toContain('eagle') // unreadable on the mail server

    await syncAccount(bea.accountId)
    const rows = await bea.browser.json<{ id: string; subject: string; security: string }[]>('GET', '/api/messages')
    const secret = rows.find((r) => r.subject === 'Secret')!
    expect(secret.security).toBe('smime-encrypted')
    expect((await bea.browser.json('GET', `/api/messages/${secret.id}`)).text).toContain('The eagle has landed')
  })

  it('asks for a certificate before signing', async () => {
    const { browser, accountId } = await sender()
    const response = await browser.post('/api/send', {
      accountId,
      to: [uniqueAddress()],
      text: 'x',
      smime: { sign: true, encrypt: false },
    })
    expect(response.json().error).toMatch(/Upload an S\/MIME certificate/)
  })
})

// Viewers were checked in accounts.int.test.ts; this covers sending from someone else's account.
describe('sending from a shared account', () => {
  it('lets an editor send as the shared address', async () => {
    const owner = await sender()
    const editor = await signedInUser(app)
    await owner.browser.json('PUT', `/api/accounts/${owner.accountId}/members`, {
      userId: editor.user.id,
      role: 'editor',
    })
    const to = uniqueAddress()
    await editor.browser.json('POST', '/api/send', {
      accountId: owner.accountId,
      to: [to],
      subject: 'From the team',
      text: 'x',
    })
    expect((await received(to))[0].from?.value[0].address).toBe(owner.email)
  })
})
