// Background work, run by BullMQ on Redis:
//   sync – check every account for new mail every 2 minutes, or right away when asked
//   send – deliver scheduled mail at the chosen time
import { Queue, Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { config } from '../config.ts'
import { db } from '../db.ts'
import { syncAccount } from '../features/mail/sync.ts'
import { sendScheduled } from '../features/send/send.ts'

const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null })

const syncQueue = new Queue('sync', { connection })
const sendQueue = new Queue('send', { connection })

const done = { removeOnComplete: true, removeOnFail: 100 }

// The job id makes this a no-op while a sync for the same account is already waiting.
export const queueSync = (accountId: string) => syncQueue.add('account', { accountId }, { jobId: `sync-${accountId}`, ...done })

export async function scheduleSend(outgoingId: string, at: Date) {
  await sendQueue.add('send', { outgoingId }, { jobId: outgoingId, delay: Math.max(0, at.getTime() - Date.now()), attempts: 3, backoff: { type: 'exponential', delay: 60_000 }, ...done })
}

export async function cancelSend(outgoingId: string) {
  await (await sendQueue.getJob(outgoingId))?.remove()
}

export async function startWorkers() {
  new Worker(
    'sync',
    async (job) => {
      if (job.name === 'all') {
        for (const { id } of await db.account.findMany({ select: { id: true } })) await queueSync(id)
        // Sessions are only checked when used; sweep the expired ones here so the table doesn't grow forever.
        await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })
      } else {
        await syncAccount(job.data.accountId)
      }
    },
    { connection, concurrency: 3 },
  ).on('failed', (job, error) => console.warn(`sync ${job?.data.accountId ?? job?.name} failed: ${error.message}`))

  new Worker('send', async (job) => sendScheduled(job.data.outgoingId, job.attemptsMade + 1 >= (job.opts.attempts ?? 1)), { connection }).on('failed', (job, error) =>
    console.warn(`scheduled send ${job?.data.outgoingId} failed: ${error.message}`),
  )

  // Redis may have lost delayed jobs (a crash before it saved), and a crash mid-send leaves a
  // message "sending". The database is the source of truth, so queue every pending one again;
  // jobs already in Redis are skipped because the job id is the message id.
  // shortcut: a crash right after SMTP accepted the mail but before it was marked sent re-sends it once.
  const pending = await db.outgoingMessage.findMany({ where: { status: { in: ['scheduled', 'sending'] } } })
  for (const outgoing of pending) {
    if (outgoing.status === 'sending') await db.outgoingMessage.update({ where: { id: outgoing.id }, data: { status: 'scheduled' } })
    await scheduleSend(outgoing.id, outgoing.scheduledFor ?? new Date())
  }

  await syncQueue.upsertJobScheduler('every-2-minutes', { every: 2 * 60_000 }, { name: 'all', opts: done })
}
