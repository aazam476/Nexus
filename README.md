<p align="center"><img src="docs/images/banner.png" alt="Nexus, an open-source, self-hosted email client: its smart inbox on an iPhone and a MacBook"></p>

<p align="center">
  <a href="https://github.com/aazam476/Nexus/stargazers"><img src="https://img.shields.io/github/stars/aazam476/Nexus?style=flat-square&color=4b55f0&label=stars" alt="Stars"></a>
  <a href="https://github.com/aazam476/Nexus/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/aazam476/Nexus/ci.yml?branch=main&style=flat-square&label=CI" alt="CI status"></a>
  <a href="https://github.com/aazam476/Nexus/commits/main"><img src="https://img.shields.io/github/last-commit/aazam476/Nexus?style=flat-square&color=4b55f0&label=last%20update" alt="Last update"></a>
  <img src="https://img.shields.io/badge/mail-IMAP%20%7C%20POP3%20%7C%20SMTP%20%7C%20Gmail%20%7C%20Outlook-4b55f0?style=flat-square" alt="IMAP, POP3, SMTP, Gmail and Outlook">
  <img src="https://img.shields.io/badge/runs%20on-Docker-4b55f0?style=flat-square" alt="Runs on Docker">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-4b55f0?style=flat-square" alt="Apache-2.0 license"></a>
</p>

<h1 align="center">Nexus</h1>

An open-source email client you host yourself.
Add all your mail accounts, and Nexus gathers them into one smart inbox:
mail from people comes first, while travel, notifications and newsletters
get their own sections. It runs on your own server or NAS, and it connects
to the rest of your self-hosted stack.

- **Any provider.** IMAP or POP3 with SMTP, plus Gmail and Outlook sign-in
  (OAuth2). Several accounts, one unified inbox.
- **Private by default.** Email HTML is sanitized and shown in a sandbox,
  remote images (tracking pixels) stay blocked until you load them, PGP runs
  in your browser, and S/MIME is built in. Mail passwords and tokens are
  stored encrypted.
- **No telemetry and no cloud.** Nothing about you or your mail is sent
  anywhere. What Nexus itself contacts on the internet:
  - the mail servers of the accounts you add;
  - Google or Microsoft, only for accounts you add with their sign-in;
  - the services you set up in a plugin (Immich, Nextcloud, Paperless);
  - an email's remote images, only when you choose to load them;
  - the websites whose feeds you follow, every 30 minutes.
- **For households and teams.** Several users, each with their own login and
  two-factor sign-in, and shared mailboxes with editor or viewer access.
- **Licensed under Apache-2.0.**

> **Status: early, no release yet.** Everything below is built and covered by
> tests against a local test mail server. Gmail and Outlook sign-in haven't
> been tried with real accounts yet. Nexus syncs your mail over IMAP or POP3
> and sends it over SMTP. It also handles scheduled send, drafts, Bcc-only
> mail, rich text or raw HTML with inline images, signatures, contacts with
> vCard import and export, rules, spam filtering, full-text search, .eml and
> .mbox import and export, dark and light themes, keyboard shortcuts (press
> `?`), and a phone layout.

## What you need

| Part | Notes |
|---|---|
| A computer that stays on and runs **Docker** | A home server, a NAS (Synology, TrueNAS, Unraid) or a rented server. Nexus runs as three containers: the app, a Postgres database and Redis. |
| One or more mail accounts | Any provider with IMAP or POP3 and SMTP. For Gmail or Outlook, either use their sign-in (see [Optional extras](#optional-extras)) or an app password. |
| HTTPS, if you use it over the internet | A reverse proxy such as Caddy or Traefik in front of Nexus. |

## Set up (about 10 minutes)

1. **Download** Nexus:
   ```bash
   git clone https://github.com/aazam476/Nexus.git && cd Nexus
   ```
2. **Configure it:**
   ```bash
   cp .env.example .env
   ```
   Open `.env` and set:
   1. `APP_SECRET` to a long random string (`openssl rand -base64 48` makes
      one);
   2. `PUBLIC_URL` to the address you'll open Nexus at, for example
      `https://mail.example.com`;
   3. `POSTGRES_PASSWORD` to a password of your own.
3. **Start it:**
   ```bash
   docker compose up -d
   ```
   The first start builds the app, which takes a few minutes.
4. **Open** `PUBLIC_URL` in your browser (port `8080` unless you set `PORT`).
   The first person to sign up becomes the admin.
5. **Add a mail account:** **Settings → Mail accounts**. Pick Google,
   Microsoft or *Other provider* and fill in its servers. Your mail shows up
   in the inbox as it syncs.
6. **Optional, more users:** admins add people in **Settings → Admin**.
   Anyone can then share their mailbox with other people in
   **Settings → Sharing**, as an editor or a viewer.

> **Important:** keep `APP_SECRET` safe and never change it. It encrypts the
> stored mail passwords; with a different secret Nexus can't read them, and
> every account has to be added again.

## Troubleshooting

| What you see | What it means and what to do |
|---|---|
| "Can't reach the Nexus server" | The app container isn't running or is still starting. Run `docker compose ps` and `docker compose logs app`. |
| The sidebar says "Can't sync …" | Hover over it to see why. Usually the password is wrong (Gmail and Outlook need an app password unless you use their sign-in), or the server name or port is. Fix it in **Settings → Mail accounts**. |
| A certificate error with your own mail server | Your server uses a self-signed certificate. Set `MAIL_ALLOW_INSECURE_TLS=true` in `.env` and restart. This turns off certificate checks for every mail server, so use it only for a server on your own network. |
| "Too Many Requests" when signing in | Sign-in allows 10 tries a minute. Wait a minute and try again. |
| Receiving works, but sending is refused | Some hosts and mail relays use a different login for sending. In **Settings → Mail accounts**, *Edit* the account and tick *Sending uses a different login*. |
| A two-factor code is refused although it's right | Each code works once. Wait for the next one (they change every 30 seconds), and check your phone's clock is set automatically. |
| Lost your two-factor device | Use one of the recovery codes you saved when you turned it on: *Use a recovery code* on the sign-in page. |
| A scheduled message says "Nexus stopped while sending this" | Nexus restarted in the middle of sending it, so it may or may not have gone out. Check **Sent**, then choose *Send now* or *Cancel*. |
| "This message is in private storage" | Only its owner can read it, while signed in. See [Private storage](#private-storage). |
| Signing in to Gmail or Outlook says it isn't set up | The server has no OAuth app for it yet. See [Gmail and Outlook sign-in](#gmail-and-outlook-sign-in), or use an app password with *Other provider*. |

## Updating

```bash
git pull
```

```bash
docker compose up -d --build
```

Nexus updates its database by itself when it starts. Your mail, settings and
accounts are kept.

To back up, save the database:

```bash
docker compose exec db pg_dump -U nexus nexus > nexus-backup.sql
```

Keep `.env` with it: the backup is useless without the same `APP_SECRET`.

## Optional extras

### Gmail and Outlook sign-in

Create an OAuth app with Google and/or Microsoft. Set its redirect URL to
`PUBLIC_URL/api/oauth/google/callback` (or `/microsoft/callback`), and put
its client ID and secret in `.env`. Without them, those buttons are greyed
out and say they aren't set up, and IMAP with an app password still works.

### Encrypt the host disk

Nexus keeps a copy of your mail in its database. Put that data on an
encrypted disk, so a stolen or thrown-away disk (or a powered-off machine)
gives nothing away:

- **Linux:** install the host with full-disk encryption (LUKS, the "encrypt
  disk" option in most installers), or keep Docker's data directory
  (`/var/lib/docker`) on an encrypted volume or encrypted ZFS dataset.
- **NAS appliances** (Synology, TrueNAS, Unraid): create an encrypted volume
  or pool and point Docker at it.

This protects data at rest. It doesn't stop someone who gets into the running
server; for your own mail, also turn on private storage.

### Private storage

Each user can turn on **Settings → Password & 2FA → Private storage**. New and
existing mail in Nexus's database is then encrypted with a key that only that
user's password unlocks: a database dump, a backup or another admin on the
server can't read it.

Good to know before turning it on:

- Search covers sender and subject only, because Nexus can no longer read
  message bodies.
- Plugins and attachment saving work only while you're signed in.
- If you forget your password, Nexus can't read its copy any more. Remove and
  re-add the account to download the mail again from your provider.
- POP3 accounts and accounts shared with other users can't use it (POP3 mail
  exists only in Nexus, so a lost password would lose it).
- Turning it on or off takes effect at once; the stored mail is encrypted (or
  decrypted) in the background, which takes a few minutes for a big mailbox.
- Drafts and scheduled messages stay unencrypted until they're sent, because
  scheduled mail must go out while you're signed out.
- Someone who controls the running server can still capture your password the
  next time you sign in, and Nexus stores your mail-account password so it can
  sync. Private storage protects stored data, not a compromised server.

### More

- **Two-factor sign-in** with an authenticator app, plus recovery codes:
  **Settings → Password & 2FA**.
- **Passkeys** (Touch ID, Windows Hello, a phone) sign in without a
  password. **Security keys** (like a YubiKey) are the second step after a
  password, instead of or as well as an app code. Both are in
  **Settings → Password & 2FA**. With private storage on, a passkey that
  supports PRF (most do) can open your mail too. Both belong to the address in
  `PUBLIC_URL`, so set it to the address people really use.
- **Undo send:** a sent message waits a few seconds (5 by default; Off, 10,
  20 or 30 in **Settings → Mail accounts**) so you can take it back from the
  notice in the corner. PGP mail is encrypted before it leaves, so it goes at
  once.
- **Shared mailboxes:** mail accounts are private to whoever added them, until
  they share one in **Settings → Sharing**. Editors can read, send and sort;
  viewers can only read.
- **Admin:** admins add and delete users, change their role, reset a
  forgotten password, turn off two-factor sign-in for someone who lost their
  phone or security key, add, delete and turn off plugins (a deleted built-in
  plugin can be restored), and see which mail accounts fail to sync:
  **Settings → Admin**.
  Admins never see anyone's mail. Resetting the password of someone with
  private storage turns it off and downloads their mail again from the mail
  server, since nobody can open the copy locked with the old password.
- **Feeds:** follow websites' RSS or Atom feeds and read their posts in Nexus,
  in the same safe reader as email: **Feeds** in the sidebar. Follow one in
  **Settings → Feeds** by pasting a feed's address, or just the website's;
  Nexus finds the feed. Feeds are checked every
  30 minutes. Star posts to keep them, search them, and bring your feeds from
  another reader (or take them away) as an OPML file. Old posts are kept unless
  you choose **Delete posts after** a week, month, 3 months or a year; starred
  posts are always kept.
- **Plugins:** save attachments to Immich, Nextcloud Files or Paperless, and
  add flights and invites to Nextcloud Calendar: **Settings → Plugins**. To
  write your own, see [docs/plugins.md](docs/plugins.md).
- **PGP and S/MIME:** create or import keys and certificates in
  **Settings → PGP & S/MIME**, then encrypt or sign per message in the
  composer.
- **Rules:** label, move, mark as read or send to spam by sender,
  recipient, subject or message text, and block senders:
  **Settings → Rules & spam**.
- **Import and export** .eml and .mbox files, and contacts as vCards:
  **Settings → Import & export** and the **Contacts** page.
- **Let people sign up themselves:** set `ALLOW_SIGNUP=true` in `.env`.
  Otherwise only admins add users.
- **Theme and layout:** light, dark or following your device, and a
  three-pane or list layout:
  **Settings → Appearance**.

## For contributors

You need Node 24 or newer and Docker.

```bash
npm install
```

```bash
docker compose -f docker-compose.dev.yml up -d
```

```bash
cp .env.example .env
```

In `.env`, set `APP_SECRET`, `PUBLIC_URL=http://localhost:5173`,
`DATABASE_URL=postgresql://nexus:nexus@localhost:5432/nexus`,
`REDIS_URL=redis://localhost:6379` and `MAIL_ALLOW_INSECURE_TLS=true` (the test
mail server uses a self-signed certificate). Then, in two terminals (the
server applies any new database migrations as it starts):

```bash
npm run dev:server
```

```bash
npm run dev:web
```

Open http://localhost:5173. The dev compose file also starts **GreenMail**, a
throwaway mail server that accepts any username and password. Add an account
with server `localhost`, IMAP port `3993`, SMTP port `3465`, SSL/TLS and any
password, then fill it with sample mail:

```bash
node scripts/seed-test-mail.ts you@nexus.test
```

### Tests

Every push runs all of these in CI ([ci.yml](.github/workflows/ci.yml)), and the coverage
appears in the run's summary.

| Tests | What they check | Run |
|---|---|---|
| Unit (`*.test.ts`) | parsing, sorting, encryption and other logic, on their own | `npm test` |
| Server integration (`*.int.test.ts`) | every API route, against a real database, Redis and the GreenMail test mail server | `npm test` (needs the dev compose services; skipped without them) |
| Browser (`apps/web/e2e/`) | the main flows in a real Chromium: setup, reading, sending, settings, phones | `npm run test:e2e -w apps/web` |

Before the first browser test run, install Chromium once:

```bash
npx -w apps/web playwright install chromium
```

The tests use their own databases (`nexus_test` and `nexus_e2e_test`), so your development data is
never touched.

### How the code is laid out

New here? Read [docs/architecture.md](docs/architecture.md) first: it follows a request and a
message through the code. Email terms are explained in [docs/glossary.md](docs/glossary.md),
and [docs/testing.md](docs/testing.md) shows how the tests work and how to write one.

```
apps/server/            Fastify API and background jobs. Node runs the .ts files directly, no build step.
  prisma/schema.prisma  the database, top to bottom: people, accounts, mail, everything else
  src/features/<area>/  one folder per feature: routes.ts (HTTP) plus the logic it uses
  src/plugins/          the plugin API (types.ts) and the built-in plugins
  src/jobs/queue.ts     mail sync every 2 minutes and scheduled sends (BullMQ on Redis)
  src/lib/              sessions, access control, encryption, errors
apps/web/               React + Vite + Tailwind web app
  src/pages/            one file per screen
  src/components/       pieces shared between screens; message/ and composer/ hold the parts of
                        the message reader and the composer
  src/lib/              talking to the API (api.ts, queries.ts), PGP, sanitizing email HTML, helpers
  e2e/                  browser tests (Playwright)
.github/workflows/      CI on every push; Docker image publishing on version tags
```

### How to contribute

- Pick the feature folder your change belongs to and follow the code around
  it. Routes stay thin: validate the input with zod (`parse`), check access
  (`requireAccountRole`), then call a plain function.
- Anything that parses, sorts, encrypts or checks permissions gets a small
  test next to it (`*.test.ts`). A new API route gets an integration test
  (`*.int.test.ts`), and a new screen or flow a browser test (`apps/web/e2e/`).
- Write comments that say *why*, not what. If something is knowingly
  incomplete, mark it `shortcut: <the limit>, <when to upgrade>` so it's easy
  to find later.
- Format your code with `npm run format` (Prettier; CI checks it).
- Run `npm test`, the browser tests and the typecheckers (`npx tsc` in
  `apps/server`, `npx tsc --noEmit` in `apps/web`) before opening a pull
  request. CI runs them all too.

### Security

Things to know as an admin:

- Every user can connect Nexus to mail servers and plugin services of their
  choosing, including addresses on your local network (that's how homelab
  services are reached). Only give accounts to people you trust with that.
- Plugins run with full access to Nexus. Install only ones you trust (see
  [docs/plugins.md](docs/plugins.md)).
- `MAIL_ALLOW_INSECURE_TLS=true` turns off certificate checks for every mail
  server. Use it only for a server on your own network.

Found a vulnerability? Please report it privately to ali@azam.email instead of
opening a public issue.

## License

Apache-2.0, see [LICENSE](LICENSE).
