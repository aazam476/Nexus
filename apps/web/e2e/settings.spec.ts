// Settings and the address book in the browser: the admin page, users, two-factor sign-in, signing out, rules,
// appearance, contacts, and PGP encryption done entirely in the browser.
import { authenticator } from 'otplib'
import { expect, test } from './fixtures.ts'
import { run, syncUntil, uniqueAddress } from './helpers.ts'

test('an admin adds a user, who signs in, turns on two-factor sign-in, and signs out', async ({ page, person }) => {
  const email = uniqueAddress('bob')
  const password = 'bobs starting password'
  await page.goto('/settings/admin')
  await expect(page.getByText('Mail accounts', { exact: true })).toBeVisible() // the server overview
  await page
    .getByRole('button', { name: /Add user/ })
    .first()
    .click()
  await page.getByLabel('Name', { exact: true }).fill('Bob Builder')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel(/^Starting password/).fill(password)
  await page.getByRole('button', { name: 'Add user', exact: true }).click()
  await expect(page.getByText('Bob Builder')).toBeVisible()

  // Bob, on his own computer.
  const bob = await person()
  await bob.goto('/login')
  await bob.getByLabel('Email', { exact: true }).fill(email)
  await bob.getByLabel(/^Password/).fill(password)
  await bob.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(bob).toHaveURL(/\/mail\/inbox$/)

  await bob.goto('/settings/security')
  const setupResponse = bob.waitForResponse('**/api/auth/2fa/setup')
  await bob.getByRole('button', { name: 'Set up two-factor authentication' }).click()
  const { secret } = await (await setupResponse).json()
  await expect(bob.getByAltText('QR code for your authenticator app')).toBeVisible()
  await bob.getByLabel('Code from the app').fill(authenticator.generate(secret))
  await bob.getByRole('button', { name: 'Verify and turn on' }).click()
  await expect(bob.getByText('Save these recovery codes somewhere safe')).toBeVisible()
  const recoveryCode = (await bob.getByRole('listitem').first().textContent())!
  await bob.getByRole('button', { name: 'I saved them' }).click()

  await bob.getByRole('button', { name: 'Sign out' }).click()
  await expect(bob).toHaveURL(/\/login$/)
  await bob.goto('/mail/inbox')
  await expect(bob).toHaveURL(/\/login$/) // really signed out

  // Signing in now asks for a code; pasting the whole code fills every box.
  await bob.getByLabel('Email', { exact: true }).fill(email)
  await bob.getByLabel(/^Password/).fill(password)
  await bob.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(bob).toHaveURL(/\/login\/2fa$/)
  // Each code works once, and turning 2FA on used the current one, so sign in with the next one.
  await bob.getByLabel('Digit 1').fill(authenticator.clone({ epoch: Date.now() + 30_000 }).generate(secret))
  await expect(bob).toHaveURL(/\/mail\/inbox$/)

  // Lost phone: a recovery code works once instead.
  await bob.getByRole('button', { name: 'Sign out' }).click()
  await bob.getByLabel('Email', { exact: true }).fill(email)
  await bob.getByLabel(/^Password/).fill(password)
  await bob.getByRole('button', { name: 'Sign in', exact: true }).click()
  await bob.getByRole('button', { name: 'Use a recovery code' }).click()
  await bob.getByLabel('Recovery code').fill(recoveryCode)
  await bob.getByRole('button', { name: 'Verify recovery code' }).click()
  await expect(bob).toHaveURL(/\/mail\/inbox$/)

  // Bob forgets his password and loses his phone: the admin resets the password and turns 2FA off.
  const row = page.getByRole('listitem').filter({ hasText: 'Bob Builder' })
  await page.reload()
  await row.getByRole('button', { name: 'Turn off 2FA' }).click()
  await expect(row.getByText('2FA off')).toBeVisible()
  await row.getByRole('button', { name: 'Reset password' }).click()
  await row.getByLabel(/^New password for Bob Builder/).fill('bobs second password')
  await row.getByRole('button', { name: 'Reset password' }).last().click()
  await expect(row.getByText(/Password reset/)).toBeVisible()
  await bob.goto('/mail/inbox')
  await expect(bob).toHaveURL(/\/login$/) // signed out everywhere
  await bob.getByLabel('Email', { exact: true }).fill(email)
  await bob.getByLabel(/^Password/).fill('bobs second password')
  await bob.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(bob).toHaveURL(/\/mail\/inbox$/) // no code asked for
})

test('the admin page is hidden from people who are not admins', async ({ page, person }) => {
  const email = uniqueAddress('dan')
  await page.request.post('/api/users', { data: { name: 'Dan', email, password: 'dans first password' } })
  const dan = await person()
  await dan.goto('/login')
  await dan.getByLabel('Email', { exact: true }).fill(email)
  await dan.getByLabel(/^Password/).fill('dans first password')
  await dan.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(dan).toHaveURL(/\/mail\/inbox$/)
  await dan.goto('/settings/sharing')
  await expect(dan.getByRole('link', { name: 'Sharing' })).toBeVisible()
  await expect(dan.getByRole('link', { name: 'Admin' })).toBeHidden()
})

test('an admin reviews and adds a plugin, turns it off for everyone, and deletes it', async ({ page }) => {
  const id = `shouty-${Date.now().toString(36)}`
  const code = `export default { id: '${id}', name: 'Shouty ${id}', description: 'Test', author: 'Tess', settings: [],
    async saveAttachment() { return { secret: process.env.APP_SECRET } } }`
  await page.goto('/settings/admin')
  const picker = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add plugin' }).click()
  await (await picker).setFiles({ name: 'shouty.mjs', mimeType: 'text/javascript', buffer: Buffer.from(code) })
  await expect(page.getByText('Install shouty.mjs?')).toBeVisible()
  await expect(page.getByText(/Reads the server’s settings/)).toBeVisible() // the quick look flags the secret
  await page.getByRole('button', { name: 'Install plugin' }).click()

  const row = page.getByRole('listitem').filter({ hasText: `Shouty ${id}` })
  await expect(row).toBeVisible()
  await row.getByRole('switch', { name: `Shouty ${id} for everyone` }).click()
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  await page.goto('/settings/plugins')
  await expect(page.getByText(`Shouty ${id}`)).toBeHidden() // off for everyone

  await page.goto('/settings/admin')
  await row.getByRole('button', { name: 'Delete' }).click()
  await expect(row).toBeHidden()
})

test('changes the password, and turns private storage on and off', async ({ page, person }) => {
  const email = uniqueAddress('cleo')
  await page.request.post('/api/users', { data: { name: 'Cleo', email, password: 'cleos first password' } })
  const cleo = await person()
  await cleo.goto('/login')
  await cleo.getByLabel('Email', { exact: true }).fill(email)
  await cleo.getByLabel(/^Password/).fill('cleos first password')
  await cleo.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(cleo).toHaveURL(/\/mail\/inbox$/)
  await cleo.goto('/settings/security')

  await cleo.getByLabel('Current password').fill('wrong password')
  await cleo.getByLabel(/^New password/).fill('cleos second password')
  await cleo.getByRole('button', { name: 'Change password' }).click()
  await expect(cleo.getByRole('alert').first()).toContainText('current password is wrong')
  await cleo.getByLabel('Current password').fill('cleos first password')
  await cleo.getByRole('button', { name: 'Change password' }).click()
  await expect(cleo.getByText(/Password changed/)).toBeVisible()
  await expect(cleo.getByText('This device')).toBeVisible()

  await cleo.getByRole('button', { name: /Turn on private storage/ }).click()
  await cleo.getByLabel('Confirm with your password').fill('cleos second password')
  await cleo.getByRole('button', { name: 'Turn on', exact: true }).click()
  await expect(cleo.getByRole('button', { name: /Turn off private storage/ })).toBeVisible()
  await cleo.getByRole('button', { name: /Turn off private storage/ }).click()
  await cleo.getByLabel('Confirm with your password').fill('cleos second password')
  await cleo.getByRole('button', { name: 'Turn off', exact: true }).click()
  await expect(cleo.getByRole('button', { name: /Turn on private storage/ })).toBeVisible()
})

test('adds a rule, which creates its label in the sidebar', async ({ page }) => {
  const label = `Receipts ${Date.now().toString(36)}`
  await page.goto('/settings/rules')
  await page.getByRole('button', { name: 'New rule' }).click()
  await page.getByLabel('Rule name').fill('Invoices')
  await page.getByLabel('Contains').fill('invoice')
  await page.getByLabel('Then').selectOption('label')
  await page.getByLabel('Label name').fill(label)
  await page.getByRole('button', { name: 'Save rule' }).click()
  await expect(page.getByText(/contains “invoice”/)).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Mailboxes' }).getByRole('link', { name: label })).toBeVisible()

  await page.getByLabel('Sender or domain to block').fill('pest.example')
  await page.getByRole('button', { name: 'Block', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Unblock pest.example' })).toBeVisible()
})

test('switches between light and dark, and remembers it', async ({ page }) => {
  await page.goto('/settings/appearance')
  await page.getByRole('button', { name: /Light/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: /Dark/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('adds, finds and removes a contact', async ({ page }) => {
  const name = `Grace ${Date.now().toString(36)}`
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByLabel('Name', { exact: true }).fill(name)
  await page.getByLabel(/^Email/).fill('grace@navy.test, hopper@home.test')
  await page.getByLabel('Company').fill('US Navy')
  await page.getByRole('button', { name: 'Save contact' }).click()
  await expect(page.getByText('hopper@home.test')).toBeVisible()

  await page.goto('/contacts')
  await page.getByLabel('Search contacts').fill('hopper@home')
  await page.getByRole('link', { name: new RegExp(name) }).click()
  await page.getByRole('button', { name: `Delete ${name}` }).click()
  await page.getByLabel('Search contacts').fill(name)
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeHidden()
})

test('PGP: creates a key, sends encrypted mail, and decrypts it, all in the browser', async ({ page }) => {
  const { mailbox } = run()
  const passphrase = 'a long pgp passphrase'
  await page.goto('/settings/encryption')
  await page.getByRole('button', { name: 'Create key' }).click()
  await page.getByLabel('Email address on the key').selectOption(mailbox)
  await page.getByLabel(/^Passphrase/).fill(passphrase)
  await page.getByLabel('Repeat passphrase').fill(passphrase)
  await page.getByRole('button', { name: 'Create key', exact: true }).last().click()
  // Making a key takes a moment; it's listed once it's saved.
  await expect(page.getByRole('button', { name: 'Export public key' })).toBeVisible({ timeout: 15_000 })

  // Encrypting to yourself needs your own public key on a contact, as for anyone else.
  const [key] = (await (await page.request.get('/api/pgp/keys')).json()) as { publicKey: string }[]
  await page.request.post('/api/contacts', { data: { name: 'Me', emails: [mailbox], pgpPublicKey: key.publicKey } })

  const title = `Secret plans ${Date.now().toString(36)}`
  await page.goto('/mail/inbox')
  await page
    .getByRole('button', { name: /^New message/ })
    .first()
    .click()
  await page.getByLabel('To', { exact: true }).fill(mailbox)
  await page.getByLabel('To', { exact: true }).press('Enter')
  await page.getByLabel('Subject').fill(title)
  await page.getByLabel('Message body').click()
  await page.keyboard.type('Meet at the old oak tree.')
  await page.getByRole('switch', { name: 'Encrypt with PGP' }).click()
  await expect(page.getByText(/can’t be unsent/)).toBeVisible() // encrypted mail skips undo send
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByText('Message sent')).toBeVisible()

  await syncUntil(page, title)
  await page.getByRole('link', { name: /^Inbox/ }).click()
  await page.getByRole('button', { name: new RegExp(title) }).click()
  await expect(page.getByText('This message is encrypted with PGP')).toBeVisible()
  await page.getByLabel('Key passphrase').fill('wrong passphrase')
  await page.getByRole('button', { name: 'Decrypt' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByLabel('Key passphrase').fill(passphrase)
  await page.getByRole('button', { name: 'Decrypt' }).click()
  await expect(page.getByText('Meet at the old oak tree.')).toBeVisible()
})
