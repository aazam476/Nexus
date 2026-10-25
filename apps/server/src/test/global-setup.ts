// Runs once before the integration tests: gives them an empty, fully migrated database
// and an empty Redis database.
import { execFileSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'
import { Redis } from 'ioredis'
import { testEnvironment } from './environment.ts'

export default async function setup() {
  const url = new URL(testEnvironment.DATABASE_URL)
  const name = url.pathname.slice(1)
  // A safety catch: this drops the whole database, so it must be a test one.
  if (!name.endsWith('_test')) throw new Error(`Refusing to wipe "${name}": the test database's name must end in _test`)

  // Connect to Postgres's own "postgres" database to drop and re-create the test database.
  const admin = new PrismaClient({ datasourceUrl: Object.assign(new URL(url), { pathname: '/postgres' }).toString() })
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
  } finally {
    await admin.$disconnect()
  }
  // Apply every migration, the same way a real Nexus does when it starts.
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env, ...testEnvironment }, stdio: 'ignore' })

  const redis = new Redis(testEnvironment.REDIS_URL)
  await redis.flushdb()
  redis.disconnect()
}
