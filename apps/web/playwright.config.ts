// Browser tests (e2e/*.spec.ts): a real Chromium clicks through the built web app, against the real
// server, database and GreenMail test mail server. Start those services first:
//   docker compose -f docker-compose.dev.yml up -d
// then run: npm run test:e2e -w apps/web
import { defineConfig, devices } from '@playwright/test'

export const PORT = 8091

export default defineConfig({
  testDir: 'e2e',
  // One at a time: the tests share one server and one database, like people sharing one Nexus.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  globalSetup: './e2e/coverage/start.ts',
  globalTeardown: './e2e/coverage/report.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    // GreenMail's dates and times are shown in the reader; pin them so tests read the same everywhere.
    timezoneId: 'UTC',
    locale: 'en-US',
  },
  projects: [
    // Creates the admin and their mail account, and saves the signed-in session for the others.
    { name: 'setup', testMatch: /first-run\.setup\.ts/ },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/admin.json' },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    // Build the app (with source maps, so coverage maps back to src/), then start a fresh server.
    command: 'npx vite build --sourcemap --logLevel warn && node e2e/start-server.ts',
    url: `http://localhost:${PORT}/api/auth/status`,
    timeout: 180_000,
    reuseExistingServer: false,
  },
})
