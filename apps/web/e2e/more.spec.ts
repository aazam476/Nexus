// The rest of the app in the browser: phones and narrow windows, attachments (preview, forward,
// plugins), import/export, account settings and sharing, contacts tools and the shortcuts help.
import { createServer } from 'node:http'
import { expect, test } from './fixtures.ts'
import { deliver, run, subjectsOnServer, syncUntil, uniqueAddress } from './helpers.ts'

const subject = (name: string) => `${name} ${Date.now().toString(36)}`

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('shows one pane at a time, with the mailboxes in a menu', async ({ page }) => {
    const title = subject('Phone mail')
    await deliver(run().mailbox, { subject: title, text: 'Small screen' })
    await page.goto('/mail/inbox')
    await syncUntil(page, title)

    await expect(page.getByRole('navigation', { name: 'Mailboxes' })).toBeHidden()
    await page.getByRole('button', { name: 'Open menu' }).click()
    const menu = page.getByRole('dialog', { name: 'Mailboxes' })
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()

    await page.getByRole('button', { name: new RegExp(title) }).click()
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Inbox' })).toBeHidden()
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page.getByRole('region', { name: 'Inbox' })).toBeVisible()

    // The composer takes the whole screen; New message is in the list's header.
    await page.getByRole('button', { name: 'New message' }).click()
    await expect(page.getByRole('region', { name: 'New message' })).toBeVisible()
    await page.getByRole('button', { name: 'Close and keep draft' }).click()
  })
})

test.describe('in a narrow desktop window', () => {
  test.use({ viewport: { width: 820, height: 700 } })

  test('keeps the sidebar, and the message replaces the list', async ({ page }) => {
    const title = subject('Narrow window')
    await deliver(run().mailbox, { subject: title, text: 'x' })
    await page.goto('/mail/inbox')
    await syncUntil(page, title)
    await expect(page.getByRole('navigation', { name: 'Mailboxes' })).toBeVisible()
    await page.getByRole('button', { name: new RegExp(title) }).click()
    await expect(page.getByRole('region', { name: 'Inbox' })).toBeHidden()
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page.getByRole('region', { name: 'Inbox' })).toBeVisible()
  })
})

test('previews and forwards attachments', async ({ page }) => {
  const title = subject('Files inside')
  await deliver(run().mailbox, { subject: title, text: 'See attached', attachments: [{ filename: 'notes.txt', content: 'Gate B12, seat 14C' }] })
  await page.goto('/mail/inbox')
  await syncUntil(page, title)
  await page.getByRole('button', { name: new RegExp(title) }).click()

  await page.getByRole('button', { name: 'Preview notes.txt' }).first().click()
  const preview = page.getByRole('dialog', { name: 'Preview of notes.txt' })
  await expect(preview.frameLocator('iframe').getByText('Gate B12, seat 14C')).toBeVisible()
  await preview.getByRole('button', { name: 'Close preview' }).click()

  const to = uniqueAddress('fwd')
  await page.getByRole('button', { name: 'Forward', exact: true }).click()
  await expect(page.getByText('Forwarding notes.txt')).toBeVisible()
  await page.getByLabel('To', { exact: true }).fill(to)
  await page.getByLabel('To', { exact: true }).press('Enter')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => subjectsOnServer(to)).toEqual([`Fwd: ${title}`])
})

test('saves an attachment to Paperless through its plugin', async ({ page }) => {
  // A stand-in Paperless server that accepts everything.
  const received: string[] = []
  const paperless = createServer((request, response) => {
    received.push(`${request.method} ${request.url}`)
    request.resume()
    request.on('end', () => response.writeHead(200, { 'content-type': 'application/json' }).end('{}'))
  })
  await new Promise<void>((resolve) => paperless.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(paperless.address() as { port: number }).port}`
  try {
    await page.goto('/settings/plugins')
    const card = page.locator('section', { has: page.getByRole('heading', { name: 'Paperless-ngx' }) })
    await card.getByRole('button', { name: 'Configure' }).click()
    await card.getByLabel('Server URL').fill(url)
    await card.getByLabel('API token').fill('secret-token')
    await card.getByRole('button', { name: 'Save' }).click()
    await card.getByRole('button', { name: 'Test connection' }).click()
    await expect(card.getByText(/works|Connected/i)).toBeVisible()
    await card.getByRole('switch', { name: 'Turn Paperless-ngx on' }).click()
    await expect(card.getByRole('switch', { name: 'Turn Paperless-ngx on' })).toHaveAttribute('aria-checked', 'true')

    const title = subject('Invoice')
    await deliver(run().mailbox, { subject: title, text: 'x', attachments: [{ filename: 'invoice.pdf', content: '%PDF-1.4 invoice', contentType: 'application/pdf' }] })
    await page.goto('/mail/inbox')
    await syncUntil(page, title)
    await page.getByRole('button', { name: new RegExp(title) }).click()
    await page.getByRole('button', { name: 'Save invoice.pdf to…' }).click()
    await page.getByRole('menuitem', { name: /Paperless/ }).click()
    await expect(page.getByRole('button', { name: 'invoice.pdf: Saved to Paperless-ngx' })).toBeVisible()
    expect(received).toContain('POST /api/documents/post_document/')
  } finally {
    paperless.close()
  }
})

test('imports an .eml file and offers exports', async ({ page }) => {
  const title = subject('From my old mail app')
  await page.goto('/settings/import-export')
  await page.locator('input[name=files]').setInputFiles({
    name: 'old.eml',
    mimeType: 'message/rfc822',
    buffer: Buffer.from(`From: Old <old@friend.test>\r\nTo: me@nexus.test\r\nSubject: ${title}\r\nDate: Mon, 1 Jan 2024 10:00:00 +0000\r\n\r\nHello from the past\r\n`),
  })
  await page.getByRole('button', { name: 'Import' }).click()
  await expect(page.getByText(/Imported 1 message/)).toBeVisible()
  await expect.poll(() => subjectsOnServer(run().mailbox, 'Archive')).toContain(title)

  await expect(page.getByRole('link', { name: 'Export .mbox' })).toHaveAttribute('href', '/api/export.mbox?')
})

test('edits an account, its signature, and shares it with another person', async ({ page }) => {
  const { mailbox } = run()
  const friend = `Dana ${Date.now().toString(36)}`
  await page.request.post('/api/users', { data: { name: friend, email: uniqueAddress('dana'), password: 'danas long password' } })

  await page.goto('/settings/accounts')
  await page.getByRole('button', { name: 'Edit' }).first().click()
  await page.getByRole('listitem').getByLabel('Display name').fill('Home mail')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/Home mail · IMAP/)).toBeVisible()
  await page.getByRole('button', { name: `Sync ${mailbox} now` }).click()

  const signature = page.getByLabel(`Signature for ${mailbox}`)
  await signature.click()
  await page.keyboard.type('Ada, from Nexus')
  await page.getByRole('heading', { name: 'Signatures' }).click() // saved when you click away
  await expect.poll(async () => ((await (await page.request.get('/api/accounts')).json()) as { signature: string }[])[0].signature).toContain('Ada, from Nexus')

  await page.goto('/settings/sharing')
  const person = page.getByLabel('Person to share with').first()
  await person.selectOption((await person.locator('option', { hasText: friend }).getAttribute('value'))!)
  await page.getByLabel('Access level').first().selectOption('editor')
  await page.getByRole('button', { name: 'Share' }).first().click()
  await expect(page.getByLabel(`Access for ${friend}`)).toHaveValue('editor')
  await page.getByRole('button', { name: 'Remove' }).first().click()
  await expect(page.getByLabel(`Access for ${friend}`)).toBeHidden()
})

test('imports vCards, and emails a contact from their page', async ({ page }) => {
  const name = `Lin ${Date.now().toString(36)}`
  await page.goto('/contacts')
  const picker = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import vCard' }).click()
  await (await picker).setFiles({ name: 'friends.vcf', mimeType: 'text/vcard', buffer: Buffer.from(`BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${name}\r\nEMAIL:lin@example.test\r\nEND:VCARD\r\n`) })
  await page.getByRole('link', { name: new RegExp(name) }).click()
  await page.getByRole('button', { name: 'Email' }).click()
  await expect(page.getByRole('region', { name: 'New message' }).getByText('lin@example.test')).toBeVisible()
})

test('shows the keyboard shortcuts with ?', async ({ page }) => {
  await page.goto('/mail/inbox')
  await page.keyboard.press('?')
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(help).toBeVisible()
  await help.getByRole('button', { name: 'Close' }).click()
  await expect(help).toBeHidden()
})
