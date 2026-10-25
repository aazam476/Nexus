// Starts Nexus: the web server and the background workers, in one process.
import { buildApp } from './app.ts'
import { config } from './config.ts'
import { db } from './db.ts'
import { closeQueues, startWorkers } from './jobs/queue.ts'
import { setEncryptionSecret } from './lib/crypto.ts'
import { loadExternalPlugins } from './plugins/registry.ts'

setEncryptionSecret(config.APP_SECRET)
await loadExternalPlugins(config.PLUGINS_DIR)

const app = await buildApp()
await startWorkers()
await app.listen({ host: '0.0.0.0', port: config.PORT })

// `docker compose stop` sends SIGTERM. Finish the requests and jobs in progress (a scheduled
// message being sent, for example) before exiting, instead of cutting them off halfway.
process.once('SIGTERM', async () => {
  await app.close()
  await closeQueues()
  await db.$disconnect()
  process.exit(0)
})
