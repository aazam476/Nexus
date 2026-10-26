// The first visit to a brand-new Nexus: create the admin, connect a mail account.
// Saves the signed-in session (.auth/admin.json) for every other browser test.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { expect, test } from './fixtures.ts'
import { runFile, uniqueAddress } from './helpers.ts'

test('a new server walks the first person through setup', async ({ page }) => {
  const details = {
    email: uniqueAddress('admin'),
    password: 'correct horse battery staple',
    mailbox: uniqueAddress('inbox'),
    accountId: '',
  }

  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Welcome to Nexus' })).toBeVisible()
  await page.getByLabel('Your name').fill('Ada Admin')
  await page.getByLabel('Email', { exact: true }).fill(details.email)
  await page.getByLabel(/^Password/).fill(details.password)
  await page.getByRole('button', { name: 'Create account' }).click()

  // An empty inbox points the way to adding an account.
  await expect(page).toHaveURL(/\/mail\/inbox$/)
  await page.getByRole('link', { name: 'Add account' }).click()
  await page.getByRole('button', { name: /Other provider/ }).click()
  await page.getByLabel('Email address', { exact: true }).fill(details.mailbox)
  await page.getByLabel('Display name').fill('Personal')
  const incoming = page.getByRole('group', { name: 'Incoming mail' })
  await incoming.getByLabel('Server').fill('localhost')
  await incoming.getByLabel('Port').fill('3993')
  await incoming.getByLabel(/^Password/).fill('any password')
  const outgoing = page.getByRole('group', { name: 'Outgoing mail (SMTP)' })
  await outgoing.getByLabel('Server').fill('localhost')
  await outgoing.getByLabel('Port').fill('3465')

  // A wrong port is refused with the reason, and nothing is saved.
  await incoming.getByLabel('Port').fill('1')
  await page.getByRole('button', { name: 'Test and add account' }).click()
  await expect(page.getByRole('alert')).toContainText('Could not connect')
  await incoming.getByLabel('Port').fill('3993')
  await page.getByRole('button', { name: 'Test and add account' }).click()
  await expect(page.getByText(details.mailbox).first()).toBeVisible()

  const accounts = (await (await page.request.get('/api/accounts')).json()) as { id: string }[]
  details.accountId = accounts[0].id
  mkdirSync(dirname(runFile), { recursive: true })
  writeFileSync(runFile, JSON.stringify(details))
  await page.context().storageState({ path: 'e2e/.auth/admin.json' })
})
