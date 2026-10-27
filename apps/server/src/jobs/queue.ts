// Background work, run by BullMQ on Redis:
//   sync – check every account for new mail every 2 minutes, or right away when asked
//   send – deliver scheduled mail at the chosen time
import { Queue, Worker, type Job } from 'bullmq'
import { Redis } from 'ioredis'
import { config } from '../config.ts'
import { db } from '../db.ts'
import { errorMessage } from '../lib/http.ts'
import { deleteOldPosts, refreshDueFeeds } from '../features/feeds/feeds.ts'
import { syncAccount } from '../features/mail/sync.ts'
import { failInterruptedSends, sendScheduled } from '../features/send/send.ts'

// BullMQ needs maxRetriesPerRequest: null, so a Redis hiccup makes workers wait instead of crash.
const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null })

const syncQueue = new Queue('sync', { connection })
const sendQueue = new Queue('send', { connection })

// What to keep in Redis after a job ends: nothing when it worked; the last 100 failures, for looking into.
const done = { removeOnComplete: true, removeOnFail: 100 }
// Sync jobs reuse one id per account, and BullMQ ignores a new job while it still keeps one with the
// same id, even a failed one. Keeping failures would stop that account syncing for good.
// The error is still logged and saved on the account (syncError).
const syncDone = { removeOnComplete: true, removeOnFail: true }

// The job id makes this a no-op while a sync for the same account is already waiting.
export const queueSync = (accountId: string) =>
  syncQueue.add('account', { accountId }, { jobId: `sync-${accountId}`, ...syncDone })

// Runs the send job at `at`. If sending fails, BullMQ tries again after 1 minute, then 2 (3 tries in all).
// The job id is the message id, so the same message can never be queued twice.
export async function scheduleSend(outgoingId: string, at: Date) {
  await sendQueue.add(
    'send',
    { outgoingId },
    {
      jobId: outgoingId,
      delay: Math.max(0, at.getTime() - Date.now()),
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 },
      ...done,
    },
  )
}

export async function cancelSend(outgoingId: string) {
  const job = await sendQueue.getJob(outgoingId)
  await job?.remove()
}

// A job on the sync queue: either "all" (every 2 minutes: queue a sync for every account, check feeds
// that are due, delete old feed posts for those who asked, and tidy up expired sessions) or "account" (sync one account now).
async function runSyncJob(job: Job) {
  if (job.name === 'all') {
    const accounts = await db.account.findMany({ select: { id: true } })
    for (const { id } of accounts) await queueSync(id)
    await refreshDueFeeds()
    await deleteOldPosts()
    // Sessions are only checked when used; sweep the expired ones here so the table doesn't grow forever.
    await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  } else {
    await syncAccount(job.data.accountId)
  }
}

// A job on the send queue: a scheduled message whose time has come.
async function runSendJob(job: Job) {
  // attemptsMade counts the attempts before this one; on the last, a failure is final (see sendScheduled).
  const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1)
  await sendScheduled(job.data.outgoingId, isLastAttempt)
}

const workers: Worker[] = []

export async function startWorkers() {
  // Up to 3 accounts sync at the same time.
  const syncWorker = new Worker('sync', runSyncJob, { connection, concurrency: 3 })
  syncWorker.on('failed', (job, error) =>
    console.warn(`sync ${job?.data.accountId ?? job?.name} failed: ${errorMessage(error)}`),
  )
  const sendWorker = new Worker('send', runSendJob, { connection })
  sendWorker.on('failed', (job, error) =>
    console.warn(`scheduled send ${job?.data.outgoingId} failed: ${errorMessage(error)}`),
  )
  workers.push(syncWorker, sendWorker)

  // Redis may have lost delayed jobs (a crash before it saved). The database is the source of
  // truth, so queue every pending one again; jobs already in Redis are skipped because the job
  // id is the message id.
  await failInterruptedSends()
  const pending = await db.outgoingMessage.findMany({ where: { status: 'scheduled' } })
  for (const outgoing of pending) await scheduleSend(outgoing.id, outgoing.scheduledFor ?? new Date())

  // Failed sync jobs kept by older versions would still block their accounts (see syncDone).
  await syncQueue.clean(0, 10_000, 'failed')

  await syncQueue.upsertJobScheduler('every-2-minutes', { every: 2 * 60_000 }, { name: 'all', opts: done })
}

// Stops the workers (letting a running job finish) and closes the Redis connection.
// Called when Nexus shuts down, and after tests.
export async function closeQueues() {
  await Promise.all(workers.map((worker) => worker.close()))
  await Promise.all([syncQueue.close(), sendQueue.close()])
  connection.disconnect()
}
