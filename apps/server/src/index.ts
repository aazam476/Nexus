// Starts Nexus: the web server and the background workers, in one process.
import { buildApp } from './app.ts'
import { config } from './config.ts'
import { startWorkers } from './jobs/queue.ts'
import { setEncryptionSecret } from './lib/crypto.ts'
import { loadExternalPlugins } from './plugins/registry.ts'

setEncryptionSecret(config.APP_SECRET)
await loadExternalPlugins(config.PLUGINS_DIR)

const app = await buildApp()
await startWorkers()
await app.listen({ host: '0.0.0.0', port: config.PORT })
