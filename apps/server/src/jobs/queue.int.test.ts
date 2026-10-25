// The background workers: account syncs and scheduled mail, run by BullMQ on the test Redis.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../db.ts'
import { encrypt } from '../lib/crypto.ts'
import { failInterruptedSends, sendScheduled } from '../features/send/send.ts'
import { addAccount, deliver, signedInUser, startApp, subjectsOnServer, uniqueAddress, waitFor } from '../test/helpers.ts'
import { queueSync, scheduleSend, startWorkers } from './queue.ts'

let app: Awaited<ReturnType<typeof startApp>>
beforeAll(async () => {
  app = await startApp()
})
afterAll(() => app.close())

// An account whose SMTP server is port 1, so every send attempt fails.
async function brokenAccount(userId: string) {
  return db.account.create({
    data: {
      ownerId: userId, email: uniqueAddress(), name: 'Broken', color: '#000000', protocol: 'imap', auth: 'password',
      inHost: 'localhost', inPort: 1, inTls: true, smtpHost: 'localhost', smtpPort: 1, smtpTls: true, username: 'x', secret: encrypt('x'),
    },
  })
}

const scheduled = (userId: string, accountId: string, to: string, status = 'scheduled') =>
  db.outgoingMessage.create({
    data: { userId, accountId, status, scheduledFor: new Date(), payload: { accountId, to: [to], subject: 'Scheduled hello', text: 'x' } },
  })

describe('scheduled send, step by step', () => {
  it('goes back to scheduled after a failed attempt, and is marked failed only after the last', async () => {
    const { user } = await signedInUser(app)
    const account = await brokenAccount(user.id)
    const outgoing = await scheduled(user.id, account.id, 'x@x.test')
    const status = async () => (await db.outgoingMessage.findUniqueOrThrow({ where: { id: outgoing.id } })).status

    await expect(sendScheduled(outgoing.id, false)).rejects.toThrow()
    expect(await status()).toBe('scheduled')
    await expect(sendScheduled(outgoing.id, true)).rejects.toThrow()
    expect(await status()).toBe('failed')
    expect((await db.outgoingMessage.findUniqueOrThrow({ where: { id: outgoing.id } })).error).toMatch(/did not accept/)
  })

  it('never re-sends a message a crash left half-sent', async () => {
    const { user } = await signedInUser(app)
    const account = await brokenAccount(user.id)
    const outgoing = await scheduled(user.id, account.id, 'x@x.test', 'sending')
    await failInterruptedSends()
    const after = await db.outgoingMessage.findUniqueOrThrow({ where: { id: outgoing.id } })
    expect(after.status).toBe('failed')
    expect(after.error).toMatch(/Check Sent/)
    // A worker finding it not "scheduled" leaves it alone instead of sending.
    await expect(sendScheduled(outgoing.id, true)).resolves.toBeUndefined()
    expect((await db.outgoingMessage.findUniqueOrThrow({ where: { id: outgoing.id } })).status).toBe('failed')
  })

  it('does nothing for a message that was cancelled meanwhile', async () => {
    await expect(sendScheduled('no-such-message', true)).resolves.toBeUndefined()
  })
})

describe('the workers', () => {
  it('deliver due mail, run account syncs, and pick up sends that were waiting during a restart', async () => {
    const { browser, user } = await signedInUser(app)
    const { id: accountId, email } = await addAccount(browser)
    const to = uniqueAddress('later')

    // Waiting in the database from before a "restart": startWorkers queues it again.
    const waiting = await scheduled(user.id, accountId, to)
    await startWorkers()
    await waitFor(async () => !(await db.outgoingMessage.findUnique({ where: { id: waiting.id } })), 'the waiting message to be sent')
    expect(await subjectsOnServer(to)).toEqual(['Scheduled hello'])
    expect(await subjectsOnServer(email, 'Sent')).toEqual(['Scheduled hello'])

    // Scheduled while running.
    const due = await scheduled(user.id, accountId, to)
    await scheduleSend(due.id, new Date())
    await waitFor(async () => !(await db.outgoingMessage.findUnique({ where: { id: due.id } })), 'the due message to be sent')
    expect(await subjectsOnServer(to)).toEqual(['Scheduled hello', 'Scheduled hello'])

    // A sync request brings new mail in.
    await deliver(email, { subject: 'Fresh', text: 'x' })
    await queueSync(accountId)
    await waitFor(async () => db.message.findFirst({ where: { accountId, subject: 'Fresh' } }), 'the sync to bring in new mail')
  })
})
