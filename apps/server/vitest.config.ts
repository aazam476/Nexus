// Two kinds of server tests:
//   unit        *.test.ts      plain functions; need nothing else running
//   integration *.int.test.ts  the real HTTP API against Postgres, Redis and the GreenMail test mail
//                              server (start them with: docker compose -f docker-compose.dev.yml up -d)
// Integration tests use their own database (nexus_test) and Redis database (1), so they never touch
// your development data. Without those services they are left out locally; in CI they must run.
import { connect } from 'node:net'
import { defineConfig } from 'vitest/config'

const reachable = (port: number) =>
  new Promise<boolean>((done) => {
    const socket = connect(port, 'localhost')
    socket.once('connect', () => {
      socket.end()
      done(true)
    })
    socket.once('error', () => done(false))
  })

export default defineConfig(async () => {
  const servicesUp = (await reachable(5432)) && (await reachable(6379)) && (await reachable(3025))
  if (!servicesUp) {
    if (process.env.CI) throw new Error('CI needs Postgres, Redis and GreenMail running for the integration tests')
    console.warn(
      '\nIntegration tests skipped: start Postgres, Redis and GreenMail with docker compose -f docker-compose.dev.yml up -d\n',
    )
  }
  return {
    test: {
      projects: [
        { test: { name: 'unit', include: ['src/**/*.test.ts'], exclude: ['src/**/*.int.test.ts'] } },
        ...(servicesUp
          ? [
              {
                test: {
                  name: 'integration',
                  include: ['src/**/*.int.test.ts'],
                  globalSetup: ['src/test/global-setup.ts'],
                  setupFiles: ['src/test/setup.ts'],
                  // One file at a time: they share the test database and the test mail server.
                  fileParallelism: false,
                  testTimeout: 30_000,
                  hookTimeout: 60_000,
                },
              },
            ]
          : []),
      ],
      coverage: {
        provider: 'v8' as const,
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.test.ts', 'src/test/**', 'src/index.ts'],
        reporter: ['text', 'text-summary', 'json-summary'],
      },
    },
  }
})
