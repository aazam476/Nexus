// Helpers for the browser tests: the test mail server (GreenMail) and the signed-in admin's details.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import type Mail from 'nodemailer/lib/mailer/index.js'

// Written by first-run.setup.ts: who the admin is and which test mailbox they connected.
export const runFile = resolve(import.meta.dirname, '.auth/run.json')
export const run = () => JSON.parse(readFileSync(runFile, 'utf8')) as { email: string; password: string; mailbox: string; accountId: string }

export const uniqueAddress = (prefix = 'e2e') => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@nexus.test`

// Delivers mail into a GreenMail mailbox, as if someone on the internet sent it.
export async function deliver(to: string, mail: Mail.Options) {
  const smtp = nodemailer.createTransport({ host: 'localhost', port: 3025, secure: false, ignoreTLS: true })
  try {
    await smtp.sendMail({ from: 'Sender <sender@example.test>', to, ...mail })
  } finally {
    smtp.close()
  }
}

// Subjects in a GreenMail mailbox folder: checks what really reached the mail server.
export async function subjectsOnServer(email: string, folder = 'INBOX'): Promise<string[]> {
  const client = new ImapFlow({ host: 'localhost', port: 3993, secure: true, auth: { user: email, pass: 'x' }, tls: { rejectUnauthorized: false }, logger: false })
  await client.connect()
  try {
    const lock = await client.getMailboxLock(folder)
    try {
      const subjects: string[] = []
      if ((client.mailbox as { exists: number }).exists === 0) return subjects
      for await (const message of client.fetch('1:*', { envelope: true })) subjects.push(message.envelope?.subject ?? '')
      return subjects
    } finally {
      lock.release()
    }
  } catch {
    return [] // the folder doesn't exist yet
  } finally {
    await client.logout()
  }
}

// Asks Nexus to check the mailbox now, waits until `subject` has arrived, then reloads the page.
export async function syncUntil(page: Page, subject: string) {
  const { accountId } = run()
  for (let attempt = 0; attempt < 50; attempt++) {
    await page.request.post(`/api/accounts/${accountId}/sync`)
    const messages = (await (await page.request.get(`/api/messages?q=${encodeURIComponent(`"${subject}"`)}`)).json()) as { subject: string }[]
    if (messages.some((m) => m.subject === subject)) return page.reload()
    await page.waitForTimeout(300)
  }
  throw new Error(`"${subject}" never arrived`)
}
