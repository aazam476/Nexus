// Runs at the start of every integration test file, before it imports any app code,
// so config.ts reads the test settings instead of your .env.
import { afterAll } from 'vitest'
import { testEnvironment } from './environment.ts'

Object.assign(process.env, testEnvironment)

const { setEncryptionSecret } = await import('../lib/crypto.ts')
setEncryptionSecret(testEnvironment.APP_SECRET)

// Close the database and Redis connections, so the test process can exit.
afterAll(async () => {
  const { db } = await import('../db.ts')
  const { closeQueues } = await import('../jobs/queue.ts')
  await closeQueues()
  await db.$disconnect()
})
