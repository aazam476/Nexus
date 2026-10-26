// Starts a real Nexus server for the browser tests, on its own empty database (nexus_e2e_test)
// and Redis database (2), so the tests never touch your development data.
import { resolve } from 'node:path'

process.env.TEST_DATABASE_URL ??= 'postgresql://nexus:nexus@localhost:5432/nexus_e2e_test'
process.env.TEST_REDIS_URL ??= 'redis://localhost:6379/2'

const serverDir = resolve(import.meta.dirname, '../../server')
process.chdir(serverDir) // Prisma and the server read their files relative to apps/server

// Reuse the server's integration-test setup: wipes and migrates the test database.
const { testEnvironment } = await import(`${serverDir}/src/test/environment.ts`)
const { default: resetDatabase } = await import(`${serverDir}/src/test/global-setup.ts`)
await resetDatabase()

Object.assign(process.env, testEnvironment, {
  PORT: '8091',
  PUBLIC_URL: 'http://localhost:8091',
  WEB_DIST: resolve(import.meta.dirname, '../dist'),
  LOG_LEVEL: 'warn',
})
await import(`${serverDir}/src/index.ts`)
