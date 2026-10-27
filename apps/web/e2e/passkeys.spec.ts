// Passkeys, with Chrome's built-in pretend passkey (a "virtual authenticator") standing in for
// Touch ID or a YubiKey: adding one, signing in without a password, opening private storage with
// it, and using it as the second step after a password.
import type { Page } from '@playwright/test'
import { authenticator } from 'otplib'
import { expect, test } from './fixtures.ts'
import { uniqueAddress } from './helpers.ts'

// A passkey that asks for a fingerprint (always given here) and supports PRF, as most do today.
async function addVirtualPasskey(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
    },
  })
}

async function signInWithPassword(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel(/^Password/).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

test('adds a passkey, signs in with it, and lets it open private storage', async ({ page, person }) => {
  const email = uniqueAddress('pia')
  const password = 'pias long password'
  await page.request.post('/api/users', { data: { name: 'Pia', email, password } })
  const pia = await person()
  await addVirtualPasskey(pia)
  await signInWithPassword(pia, email, password)
  await expect(pia).toHaveURL(/\/mail\/inbox$/)

  await pia.goto('/settings/security')
  await pia.getByRole('button', { name: 'Add a passkey or security key' }).click()
  await pia.getByLabel('Name it, to tell it apart').fill('Laptop')
  await pia.getByRole('button', { name: 'Continue' }).click()
  await expect(pia.getByText('Laptop added.')).toBeVisible()

  // No password needed.
  await pia.getByRole('button', { name: 'Sign out' }).click()
  await pia.getByRole('button', { name: 'Sign in with a passkey' }).click()
  await expect(pia).toHaveURL(/\/mail\/inbox$/)

  // Private storage needs the passkey's own secret before a sign-in without the password can open it.
  await pia.goto('/settings/security')
  await pia.getByRole('button', { name: /Turn on private storage/ }).click()
  await pia.getByLabel('Confirm with your password').fill(password)
  await pia.getByRole('button', { name: 'Turn on', exact: true }).click()
  await expect(pia.getByText(/can’t open private storage yet/)).toBeVisible()
  await pia.getByRole('button', { name: 'Let it open private storage' }).click()
  await expect(pia.getByText('Laptop can now open your private storage.')).toBeVisible()

  await pia.getByRole('button', { name: 'Sign out' }).click()
  await pia.getByRole('button', { name: 'Sign in with a passkey' }).click()
  await expect(pia).toHaveURL(/\/mail\/inbox$/) // refused if the passkey couldn't open private storage
})

test('a passkey works as the second step after a password', async ({ page, person }) => {
  const email = uniqueAddress('quin')
  const password = 'quins long password'
  await page.request.post('/api/users', { data: { name: 'Quin', email, password } })
  const quin = await person()
  await addVirtualPasskey(quin)
  await signInWithPassword(quin, email, password)
  await expect(quin).toHaveURL(/\/mail\/inbox$/)
  await quin.goto('/settings/security')

  const setup = quin.waitForResponse('**/api/auth/2fa/setup')
  await quin.getByRole('button', { name: 'Set up two-factor authentication' }).click()
  const { secret } = await (await setup).json()
  await quin.getByLabel('Code from the app').fill(authenticator.generate(secret))
  await quin.getByRole('button', { name: 'Verify and turn on' }).click()
  await quin.getByRole('button', { name: 'I saved them' }).click()
  await quin.getByRole('button', { name: 'Add a passkey or security key' }).click()
  await quin.getByLabel('Name it, to tell it apart').fill('YubiKey')
  await quin.getByRole('button', { name: 'Continue' }).click()
  await expect(quin.getByText('YubiKey added.')).toBeVisible()

  await quin.getByRole('button', { name: 'Sign out' }).click()
  await signInWithPassword(quin, email, password)
  await expect(quin).toHaveURL(/\/login\/2fa$/)
  await quin.getByRole('button', { name: 'Use a passkey or security key' }).click()
  await expect(quin).toHaveURL(/\/mail\/inbox$/)
})
