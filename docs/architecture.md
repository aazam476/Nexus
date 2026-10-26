# How Nexus works

This page walks through Nexus from the outside in: what runs, where a request goes, and how mail
gets in and out. Read it before your first change. Email words you may not know (IMAP, MIME,
S/MIME…) are explained in the [glossary](glossary.md).

## What runs

```
 Browser ──HTTP──▶  app container ─────────────▶  Postgres  (users, accounts, a copy of the mail)
 (React app)        │  Fastify API             └─▶  Redis     (the job queue)
                    │  background workers
                    └──IMAP / POP3 / SMTP──▶ your mail providers
                    └──HTTPS──▶ plugin services (Immich, Nextcloud, Paperless)
```

- **apps/web**: the React app people use. It only talks to the Nexus API (`/api/...`), never to
  mail servers directly.
- **apps/server**: one Node process that is both the HTTP API and the background workers.
  Node runs the `.ts` files directly; there is no build step for the server.
- **Postgres** keeps users, settings and a copy of every synced message (so lists and search are
  fast and work offline from the provider). The schema is `apps/server/prisma/schema.prisma`.
- **Redis** holds the job queue (BullMQ): "sync this account", "send this message at 08:00".

## A request, step by step

Say the browser asks for the inbox: `GET /api/messages?folder=inbox`.

1. `app.ts` adds security headers and, for anything that changes data, checks the request came
   from Nexus itself (the `Origin` check), not another website.
2. The route lives in `features/mail/routes.ts`. Its `preHandler` is `requireUser`
   (`lib/session.ts`): it reads the session cookie, looks up the session by the cookie's hash and
   puts the user on `request.user`. No valid session means a 401.
3. The handler validates its input with zod (`parse` in `lib/http.ts`): bad input is a 400 that
   names the field.
4. Access is checked with `lib/access.ts`: every mail account has an owner, and can be shared with
   other users as **editor** (read, send, sort) or **viewer** (read only). Someone without any
   access gets a 404, as if the account didn't exist.
5. The handler reads Postgres through Prisma (`db.ts`) and returns JSON.
6. Errors: throwing an `HttpError` (or `badRequest`, `forbidden`, `notFound`) becomes a JSON
   `{ error }` with that status. Any other error becomes a generic 500, and the details go only
   to the server log, never to the user.

The web app calls the API through `apps/web/src/lib/api.ts` and caches results with React Query
(`lib/queries.ts`).

## Mail coming in: sync

`features/mail/sync.ts`, run by a worker every 2 minutes per account, or right away when asked.

- **IMAP** (two-way): find the server's folders and map them to Nexus's (inbox, sent, archive,
  spam, trash, drafts); download messages newer than the last one seen; then mirror read, starred
  and deleted state changed in other mail apps.
- **POP3** (one-way): download anything not seen before (by its unique id). Folders and flags then
  live only in Nexus. Our own small POP3 client is in `features/accounts/pop3.ts`.

Each new message is parsed (`parse.ts`), sorted (`sorting.ts`: your rules, blocked senders, spam
score, then a section such as People or Newsletters) and saved (`store.ts`).

When you archive, star or delete in Nexus, `actions.ts` makes the change **on the mail server
first**, then in the database, so every mail app shows the same thing.

## Mail going out: send

`features/send/`. The composer posts to `/api/send`.

1. `buildMessage` turns it into a real email (MIME): text and HTML versions, attachments, pasted
   images as inline attachments, and S/MIME signing or encryption when asked.
2. `sendNow` hands it to the account's SMTP server. Only after that succeeds does it file a copy
   in Sent and remember the recipients as contacts. A problem in those last steps is logged, not
   reported as a failed send, so nobody sends the same mail twice.
3. Scheduled mail is saved in `OutgoingMessage` and a delayed job is queued (`jobs/queue.ts`).
   At the chosen time a worker claims it (`scheduled` → `sending`) and sends it.

## Security in one place

| What | Where |
|---|---|
| Passwords | scrypt hashes (`lib/crypto.ts`) |
| Mail passwords, OAuth tokens, 2FA secrets, plugin settings | AES-256-GCM, key derived from `APP_SECRET` (`lib/crypto.ts`) |
| Sessions | random token in an httpOnly, SameSite=Strict cookie; only its hash is stored (`lib/session.ts`) |
| Email HTML | sanitized with DOMPurify, shown in a sandboxed iframe with no scripts; remote images blocked until asked (`apps/web/src/lib/sanitize.ts`, `components/SafeHtml.tsx`) |
| Private storage | each user's mail sealed to their own key, unlocked by their password (`lib/sealed.ts`, `features/mail/private.ts`) |
| PGP | entirely in the browser (`apps/web/src/lib/pgp.ts`); the server never sees a usable private key |

## Plugins

A plugin is one object (`plugins/types.ts`) that can save an attachment somewhere and/or create a
calendar event. Built-in ones live in `apps/server/src/plugins/`; others are loaded from
`PLUGINS_DIR` at start-up. See [plugins.md](plugins.md).

## Tests

| Kind | Where | Needs | Run |
|---|---|---|---|
| Unit | `*.test.ts` next to the code | nothing | `npm test` |
| Server integration | `apps/server/src/**/*.int.test.ts` | Postgres, Redis, GreenMail (`docker compose -f docker-compose.dev.yml up -d`) | `npm test` (skipped when the services are down) |
| Browser | `apps/web/e2e/*.spec.ts` | the same services, plus `npx -w apps/web playwright install chromium` once | `npm run test:e2e -w apps/web` |

Integration and browser tests use their own databases (`nexus_test`, `nexus_e2e_test`), so they
never touch your development data. CI (`.github/workflows/ci.yml`) runs all of them on every push.
