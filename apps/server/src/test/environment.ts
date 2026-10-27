import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The settings the integration tests run with. Shared by global-setup.ts (before any test file)
// and setup.ts (inside each test file's process), so both point at the same test database.
export const testEnvironment = {
  // A separate database, so tests can wipe it freely. Override with TEST_DATABASE_URL.
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://nexus:nexus@localhost:5432/nexus_test',
  // Redis database 1: a development server on database 0 won't pick up the tests' jobs.
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1',
  APP_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  PUBLIC_URL: 'http://localhost:8080',
  // GreenMail uses a self-signed certificate.
  MAIL_ALLOW_INSECURE_TLS: 'true',
  LOG_LEVEL: 'silent',
  // Plugins admins upload in the tests go here, not into the real plugins folder.
  PLUGINS_DIR: join(tmpdir(), 'nexus-test-plugins'),
  // Google sign-in is "set up" (against a fake Google in the tests); Microsoft is left unset on purpose.
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
}
