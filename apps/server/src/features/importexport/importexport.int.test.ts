// Importing .eml and .mbox files, and exporting mail as .mbox.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../db.ts'
import { syncAccount } from '../mail/sync.ts'
import { Browser, addAccount, signedInUser, startApp, subjectsOnServer, uniqueAddress } from '../../test/helpers.ts'

let app: Awaited<ReturnType<typeof startApp>>
beforeAll(async () => {
  app = await startApp()
})
afterAll(() => app.close())

const eml = (subject: string, body = 'Hello') => `From: Old Friend <old@friend.test>\r\nTo: me@nexus.test\r\nSubject: ${subject}\r\nDate: Mon, 1 Jan 2024 10:00:00 +0000\r\n\r\n${body}\r\n`

// Uploads files the way the browser's file picker does: a multipart form.
async function upload(browser: Browser, fields: Record<string, string>, files: { name: string; content: string }[]) {
  const boundary = '----nexus-test-boundary'
  const parts = [
    ...Object.entries(fields).map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
    ...files.map((f) => `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n${f.content}\r\n`),
    `--${boundary}--\r\n`,
  ]
  return browser.request('POST', '/api/import', parts.join(''), { 'content-type': `multipart/form-data; boundary=${boundary}` })
}

describe('import', () => {
  it('puts .eml and .mbox files on the IMAP server, where every mail app sees them', async () => {
    const { browser } = await signedInUser(app)
    const { id, email } = await addAccount(browser)
    const mbox = `From old@friend.test Mon Jan  1 10:00:00 2024\n${eml('From the mbox 1')}\nFrom old@friend.test Mon Jan  1 11:00:00 2024\n${eml('From the mbox 2', '>From the archive, a line that looked like a separator')}\n`

    const response = await upload(browser, { accountId: id, folder: 'archive' }, [
      { name: 'one.eml', content: eml('Single file') },
      { name: 'export.mbox', content: mbox },
    ])
    expect(response.json()).toEqual({ imported: 3 })
    expect((await subjectsOnServer(email, 'Archive')).sort()).toEqual(['From the mbox 1', 'From the mbox 2', 'Single file'])

    await syncAccount(id)
    const archived = await browser.json<{ subject: string; unread: boolean }[]>('GET', '/api/messages?folder=archive')
    expect(archived.map((m) => [m.subject, m.unread]).sort()).toEqual([['From the mbox 1', false], ['From the mbox 2', false], ['Single file', false]])
    const unescaped = await db.message.findFirstOrThrow({ where: { accountId: id, subject: 'From the mbox 2' } })
    expect(unescaped.text?.trim()).toBe('From the archive, a line that looked like a separator')
  })

  it('stores imports for POP3 accounts in Nexus itself', async () => {
    const { browser } = await signedInUser(app)
    const { id } = await addAccount(browser, uniqueAddress('pop'), 'pop3')
    await upload(browser, { accountId: id, folder: 'inbox' }, [{ name: 'a.eml', content: eml('Into POP3') }])
    expect((await browser.json<{ subject: string }[]>('GET', '/api/messages')).map((m) => m.subject)).toEqual(['Into POP3'])
  })

  it('refuses empty uploads, unknown folders and accounts you can only view', async () => {
    const owner = await signedInUser(app)
    const { id } = await addAccount(owner.browser)
    expect((await upload(owner.browser, { accountId: id, folder: 'archive' }, [])).json().error).toMatch(/at least one/)
    expect((await upload(owner.browser, { accountId: id, folder: 'drafts' }, [{ name: 'a.eml', content: eml('x') }])).statusCode).toBe(400)

    const viewer = await signedInUser(app)
    await owner.browser.json('PUT', `/api/accounts/${id}/members`, { userId: viewer.user.id, role: 'viewer' })
    expect((await upload(viewer.browser, { accountId: id, folder: 'archive' }, [{ name: 'a.eml', content: eml('x') }])).statusCode).toBe(403)
  })
})

describe('export', () => {
  it('exports a folder as an .mbox file that imports back unchanged', async () => {
    const { browser } = await signedInUser(app)
    const { id } = await addAccount(browser, uniqueAddress('pop'), 'pop3')
    await upload(browser, { accountId: id, folder: 'inbox' }, [{ name: 'a.eml', content: eml('Keep me', 'From here on, a tricky line') }])
    await upload(browser, { accountId: id, folder: 'archive' }, [{ name: 'b.eml', content: eml('Archived') }])

    const inbox = await browser.get(`/api/export.mbox?account=${id}&folder=inbox`)
    expect(inbox.headers['content-type']).toBe('application/mbox')
    expect(inbox.headers['content-disposition']).toBe('attachment; filename="nexus-inbox.mbox"')
    expect(inbox.body).toMatch(/^From old@friend\.test /)
    expect(inbox.body).toContain('>From here on, a tricky line') // escaped, so it can't start a new message
    expect(inbox.body).not.toContain('Archived')

    const everything = await browser.get('/api/export.mbox')
    expect(everything.body.match(/^From old@friend\.test /gm)).toHaveLength(2)

    // Round trip: importing the export gives back the same message.
    const { id: other } = await addAccount(browser, uniqueAddress('pop'), 'pop3')
    await upload(browser, { accountId: other, folder: 'inbox' }, [{ name: 'back.mbox', content: inbox.body }])
    const back = await db.message.findFirstOrThrow({ where: { accountId: other } })
    expect([back.subject, back.text?.trim()]).toEqual(['Keep me', 'From here on, a tricky line'])
  })
})
