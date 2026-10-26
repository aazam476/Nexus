# How the tests work

Nexus has three kinds of tests. This page explains how each one is set up, so you can read them,
trust them, and add your own. For running them, see the README's "For contributors" section.

## 1. Unit tests: one function at a time

Files: `*.test.ts`, next to the code they test (for example `features/mail/sorting.test.ts`).

They call a function directly and check what it returns. Nothing else needs to be running.
Use them for logic you can test with plain inputs: parsing, sorting rules, formatting, crypto.

```ts
it('blocks a whole domain and its subdomains', () => {
  expect(isBlocked('bob@mail.spam.test', ['spam.test'])).toBe(true)
})
```

## 2. Server integration tests: the real API

Files: `apps/server/src/**/*.int.test.ts` (`int` for integration).

These start the real server in memory and send it HTTP requests, the way the web app does. The
server talks to a real Postgres database, Redis and **GreenMail**, a throwaway mail server that
accepts any username and password. So a test can send real mail and check it arrived.

### What happens when you run them

1. `apps/server/vitest.config.ts` checks that Postgres, Redis and GreenMail are reachable.
   If they aren't, integration tests are left out locally (CI insists they run).
2. `src/test/global-setup.ts` runs once: it deletes and re-creates the **`nexus_test`**
   database, applies every migration, and empties Redis database 1. Your development data, in
   the `nexus` database and Redis database 0, is never touched.
3. `src/test/setup.ts` runs at the start of each test file: it switches the settings
   (`process.env`) to the test ones from `src/test/environment.ts`.
4. Test files run one at a time, because they share the test database and mail server.
   Each test creates its own users and mailboxes (with random names), so they don't collide.

### The helpers (`src/test/helpers.ts`)

| Helper | What it does |
|---|---|
| `startApp()` | builds the server, ready for requests (no real network port) |
| `signedInUser(app)` | creates a user and signs them in; returns `{ user, browser }` |
| `browser.json('POST', '/api/…', body)` | sends a request with the user's cookie; fails the test on an error |
| `browser.post(…)`, `.get(…)`, … | the same, but returns the raw response, for checking errors |
| `addAccount(browser)` | adds a GreenMail mailbox as a mail account, through the API |
| `deliver(address, mail)` | sends mail into a GreenMail mailbox, as if from the internet |
| `subjectsOnServer(address, folder)` | reads a mailbox on GreenMail, to check what really happened there |

A `Browser` is a pretend web browser: it remembers its session cookie, and each one has its own
IP address, so the sign-in rate limit (10 tries a minute per address) doesn't trip up tests.

### Writing one

```ts
it('archives a message on the mail server too', async () => {
  const { browser } = await signedInUser(app)
  const { id, email } = await addAccount(browser)
  await deliver(email, { subject: 'Keep', text: 'x' })
  await syncAccount(id)
  const [message] = await browser.json('GET', '/api/messages')

  await browser.json('POST', `/api/messages/${message.id}/move`, { to: 'archive' })

  expect(await subjectsOnServer(email, 'Archive')).toEqual(['Keep'])
})
```

Things the real world does that tests fake:
- **Google sign-in**: `vi.stubGlobal('fetch', …)` replaces Google's token server with a fake
  that answers the way Google does (see `accounts.int.test.ts`).
- **Immich, Nextcloud, Paperless**: a small HTTP server inside the test plays those services and
  records every request, so the test checks exactly what Nexus sent (see `plugins.int.test.ts`).

## 3. Browser tests: the whole app, clicked through

Files: `apps/web/e2e/*.spec.ts`, run by **Playwright**, which drives a real Chromium.

`npm run test:e2e -w apps/web` does this:

1. Builds the web app, then `e2e/start-server.ts` starts a real Nexus server on port 8091 with
   its own empty database, **`nexus_e2e_test`**.
2. `first-run.setup.ts` goes first: it signs up the admin and connects a GreenMail mailbox, the
   way a new user would, and saves the signed-in session in `e2e/.auth/`.
3. The other files reuse that session and click through the app: reading, sending, settings,
   phone layouts. They find things by what people see (`getByRole('button', { name: 'Send' })`),
   not by CSS classes, so they keep working when the styling changes.

### What every browser test checks for free (`e2e/fixtures.ts`)

- **No JavaScript errors** on the page.
- **No `alert()` or `prompt()`**. An email that managed to run a script would show up as one of
  these, so this is an extra check against XSS. The app's own "Are you sure?" questions are
  answered yes.
- **Coverage**: which lines of the app ran, recorded from Chromium. One detail: every full page
  load (`page.goto`, `page.reload`) starts a fresh copy of the app, and the report keeps only one
  copy per address, so the fixture saves what ran before each load.

Need a second person (someone you share an account with, say)? Ask for `person` and call
`await person()` to get another, separate browser window.

### Writing one

```ts
test('stars a message', async ({ page }) => {
  await deliver(run().mailbox, { subject: 'Important', text: 'x' })
  await page.goto('/mail/inbox')
  await syncUntil(page, 'Important') // asks Nexus to check the mailbox, waits, reloads
  await page.getByRole('button', { name: /Important/ }).click()
  await page.getByRole('button', { name: 'Star', exact: true }).click()
  await page.getByRole('link', { name: /^Starred/ }).click()
  await expect(page.getByRole('button', { name: /Important/ })).toBeVisible()
})
```

Tips:
- The screen often updates before the server does (see `updateLocally` in `MailPage.tsx`). When
  checking the server, use `expect.poll(() => …)`, which keeps asking until it agrees.
- When a test fails, Playwright saves a trace in `apps/web/test-results/`. Open it with
  `npx playwright show-trace <path>` to see each step, the page, and the network.

## Coverage

Each run writes a coverage report: `apps/server/coverage/`, `apps/web/coverage/` (unit tests of
`src/lib`) and `apps/web/coverage-e2e/` (browser tests; open its `index.html`). CI shows all three
in the run's summary. Aim tests at what can break (parsing, permissions, data changes, flows people
use), not at the percentage.
