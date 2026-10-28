// Writing mail in the browser: sending with an attachment, scheduling, drafts and Bcc-only mail.
import { expect, test } from './fixtures.ts'
import { subjectsOnServer, uniqueAddress } from './helpers.ts'

const subject = (name: string) => `${name} ${Date.now().toString(36)}`

// Opens the composer and fills in one recipient, a subject and a body.
async function write(page: import('@playwright/test').Page, to: string, title: string, body: string) {
  await page.goto('/mail/inbox')
  await page
    .getByRole('button', { name: /^New message/ })
    .first()
    .click()
  await page.getByLabel('To', { exact: true }).fill(to)
  await page.getByLabel('To', { exact: true }).press('Enter')
  await page.getByLabel('Subject').fill(title)
  await page.getByLabel('Message body').click()
  await page.keyboard.type(body)
}

test('sends a formatted message with an attachment', async ({ page }) => {
  const to = uniqueAddress('to')
  const title = subject('Quarterly report')
  await write(page, to, title, 'Numbers attached. ')
  await page.keyboard.press('ControlOrMeta+b')
  await page.keyboard.type('Read this first.')
  const picker = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Attach files' }).click()
  await (await picker).setFiles({ name: 'report.csv', mimeType: 'text/csv', buffer: Buffer.from('q,total\nq3,42\n') })
  await expect(page.getByText('report.csv')).toBeVisible()

  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByText('Message sent')).toBeVisible()
  await expect.poll(() => subjectsOnServer(to), { timeout: 15_000 }).toEqual([title])
})

test('refuses to send without a recipient, saying why', async ({ page }) => {
  await page.goto('/mail/inbox')
  await page
    .getByRole('button', { name: /^New message/ })
    .first()
    .click()
  await page.getByLabel('Subject').fill('Nobody to send to')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('recipient')
})

test('schedules a message, shows it in Scheduled, and cancels it', async ({ page }) => {
  const to = uniqueAddress('later')
  const title = subject('Good morning')
  await write(page, to, title, 'Sent while you sleep.')
  await page.getByRole('button', { name: 'Schedule send' }).click()
  await page.getByRole('menuitem', { name: /Tomorrow morning/ }).click()
  await expect(page.getByText(/^Scheduled for/)).toBeVisible()

  await page.getByRole('link', { name: /^Scheduled/ }).click()
  await page.getByRole('button', { name: new RegExp(title) }).click()
  await expect(page.getByText(/Scheduled to send/)).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('button', { name: new RegExp(title) })).toBeHidden()
  expect(await subjectsOnServer(to)).toEqual([])
})

test('keeps an unfinished message as a draft, and reopens it in the composer', async ({ page }) => {
  const title = subject('Half written')
  await write(page, uniqueAddress(), title, 'To be continued')
  await page.getByRole('button', { name: 'Close and keep draft' }).click()

  await page.getByRole('link', { name: /^Drafts/ }).click()
  await page.getByRole('button', { name: new RegExp(title) }).click()
  await expect(page.getByLabel('Subject')).toHaveValue(title)
  await expect(page.getByLabel('Message body')).toContainText('To be continued')

  await page.getByRole('button', { name: 'Discard draft' }).click()
  await expect(page.getByRole('button', { name: new RegExp(title) })).toBeHidden()
})

test('explains Bcc-only mail before it is sent', async ({ page }) => {
  const hidden = uniqueAddress('bcc')
  const title = subject('Quiet note')
  await page.goto('/mail/inbox')
  await page
    .getByRole('button', { name: /^New message/ })
    .first()
    .click()
  await page.getByRole('button', { name: 'Cc / Bcc' }).click()
  await page.getByLabel('Bcc', { exact: true }).fill(hidden)
  await page.getByLabel('Bcc', { exact: true }).press('Enter')
  await expect(page.getByText(/Sending to Bcc only/)).toBeVisible()
  await page.getByLabel('Subject').fill(title)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => subjectsOnServer(hidden), { timeout: 15_000 }).toEqual([title])
})

test('formats text, links, lists, fonts, images and raw HTML, and the recipient gets all of it', async ({ page }) => {
  const to = uniqueAddress('fmt')
  const title = subject('Formatted')
  await write(page, to, title, 'Plain start. ')
  const toolbar = page.getByRole('toolbar', { name: 'Formatting' })

  await toolbar.getByRole('button', { name: 'Italic' }).click()
  await page.keyboard.type('slanted')
  await toolbar.getByRole('button', { name: 'Italic' }).click()
  await page.keyboard.press('Enter')
  await toolbar.getByRole('button', { name: 'Bulleted list' }).click()
  await page.keyboard.type('first point')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('docs')
  await page.keyboard.press('Shift+Home')
  await toolbar.getByRole('button', { name: 'Link' }).click() // the fixture answers the address question
  await page.keyboard.press('End')
  await toolbar.getByLabel('Font').selectOption({ label: 'Georgia' })

  const picker = page.waitForEvent('filechooser')
  await toolbar.getByRole('button', { name: 'Insert image' }).click()
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  )
  await (await picker).setFiles({ name: 'dot.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByLabel('Message body').locator('img[alt="dot.png"]')).toBeVisible()

  // The HTML view shows the same message as code, with a safe preview.
  await page.getByRole('button', { name: 'HTML', exact: true }).click()
  const source = page.getByLabel('HTML source')
  await expect(source).toHaveValue(/<i>slanted<\/i>|<em>slanted<\/em>/)
  await expect(source).toHaveValue(/<a href="https:\/\/example\.com\/docs">docs<\/a>/)
  await source.fill(`${await source.inputValue()}<p>Added in <strong>HTML</strong></p>`)
  await expect(page.frameLocator('iframe[title="HTML preview"]').getByText('Added in')).toBeVisible()
  await page.getByRole('button', { name: 'HTML', exact: true }).click()
  await expect(page.getByLabel('Message body').getByText('Added in')).toBeVisible()

  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => subjectsOnServer(to), { timeout: 15_000 }).toEqual([title])
})

test('undo send: takes a message back, sends it on View message, and goes by itself when the time is up', async ({
  page,
}) => {
  const to = uniqueAddress('undo')
  const notice = page.getByRole('status').filter({ hasText: 'Message sent.' })
  await page.goto('/settings/accounts')
  await page.getByLabel('Wait before sending').selectOption({ label: '30 seconds' })
  await expect(page.getByLabel('Wait before sending')).toHaveValue('30')

  // Undo send brings it back to the composer, unsent.
  const first = subject('Wrong attachment')
  await write(page, to, first, 'Oops.')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await notice.getByRole('button', { name: 'Undo send' }).click()
  await expect(page.getByLabel('Subject')).toHaveValue(first)
  expect(await subjectsOnServer(to)).toEqual([])

  // View message sends it at once, and opens the copy in Sent.
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await notice.getByRole('button', { name: 'View message' }).click()
  await expect(page).toHaveURL(/\/mail\/sent\/\w+/, { timeout: 15_000 })
  await expect(page.getByRole('heading', { name: first })).toBeVisible()
  expect(await subjectsOnServer(to)).toEqual([first])

  // When the time is up it goes by itself, and the notice stays without Undo send.
  await page.goto('/settings/accounts')
  await page.getByLabel('Wait before sending').selectOption({ label: '5 seconds' })
  await expect(page.getByLabel('Wait before sending')).toHaveValue('5')
  const second = subject('On its way')
  await write(page, to, second, 'Here it comes.')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(notice.getByRole('button', { name: 'Undo send' })).toBeVisible()
  await expect(notice.getByRole('button', { name: 'Undo send' })).toBeHidden({ timeout: 10_000 })
  await expect(notice).toBeVisible()
  await expect.poll(() => subjectsOnServer(to), { timeout: 15_000 }).toContain(second)
  await notice.getByRole('button', { name: 'Close' }).click()
  await expect(notice).toBeHidden()
})
