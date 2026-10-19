# Nexus

An open-source, self-hosted email client. Many accounts in one smart inbox, private by default, and plugged into the rest of your self-hosted stack.

- **Smart inbox**: mail from people comes first; travel, notifications and newsletters get their own sections, and machine mail collapses into bundles.
- **Any provider**: IMAP or POP3 with SMTP, plus Gmail and Outlook sign-in (OAuth2). Several accounts, one unified inbox.
- **Private**: email HTML is sanitized and sandboxed, remote images (tracking pixels) are blocked until you ask, PGP runs in your browser, and S/MIME is built in. Passwords and tokens are stored encrypted.
- **For households and teams**: several users, each with their own login and 2FA, and shared mailboxes with editor or viewer access.
- **Plugins**: save attachments to Immich, Nextcloud Files or Paperless, and add flights and invites to Nextcloud Calendar. Write your own: see [docs/plugins.md](docs/plugins.md).
- Also: scheduled send, drafts, Bcc-only mail, rich text or raw HTML with inline images, signatures, contacts with vCard import/export, rules, spam filtering, full-text search, .eml/.mbox import and export, dark and light themes, keyboard shortcuts (press `?`), and a phone layout.

## Run it

You need Docker.

```bash
cp .env.example .env
```

Open `.env` and set `APP_SECRET` to a long random string (`openssl rand -base64 48` makes one) and `PUBLIC_URL` to the address you'll open Nexus at. Then:

```bash
docker compose up -d
```

Open the address in your browser. The first person to sign up becomes the admin; after that, admins add users in **Settings → Users & sharing**.

Put Nexus behind HTTPS (a reverse proxy like Caddy or Traefik) before using it over the internet. Sign-in cookies are marked secure automatically when `PUBLIC_URL` starts with `https://`.

**Keep `APP_SECRET` safe and don't change it.** It encrypts the stored mail passwords; with a different secret Nexus can't read them and you'll need to re-enter them.

### Gmail and Outlook sign-in

Create an OAuth app with Google and/or Microsoft, set its redirect URL to `PUBLIC_URL/api/oauth/google/callback` (or `/microsoft/callback`), and put the client ID and secret in `.env`. Without them, those buttons explain what's missing; IMAP with an app password still works.

## Develop

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

In `.env`, set `APP_SECRET`, `PUBLIC_URL=http://localhost:5173`, `DATABASE_URL=postgresql://nexus:nexus@localhost:5432/nexus`, `REDIS_URL=redis://localhost:6379` and `MAIL_ALLOW_INSECURE_TLS=true` (the test mail server uses a self-signed certificate). Then, in two terminals:

```bash
npm run dev:server
```

```bash
npm run dev:web
```

Open http://localhost:5173. The dev compose file also starts **GreenMail**, a throwaway mail server that accepts any username and password. Add an account with server `localhost`, IMAP port `3993`, SMTP port `3465`, SSL/TLS, and any password, then fill it with sample mail:

```bash
node scripts/seed-test-mail.ts you@nexus.test
```

Run the tests with `npm test`.

## How the code is laid out

```
apps/server/            Fastify API and background jobs. Node runs the .ts files directly, no build step.
  prisma/schema.prisma  the database, top to bottom: people, accounts, mail, everything else
  src/features/<area>/  one folder per feature: routes.ts (HTTP) plus the logic it uses
  src/plugins/          the plugin API (types.ts) and the built-in plugins
  src/jobs/queue.ts     mail sync every 2 minutes and scheduled sends (BullMQ on Redis)
  src/lib/              sessions, access control, encryption, errors
apps/web/               React + Vite + Tailwind web app
  src/pages/            one file per screen
  src/components/       pieces shared between screens
  src/lib/              talking to the API (api.ts, queries.ts), PGP, sanitizing email HTML
```

### Contributing

- Pick the feature folder your change belongs to and follow the code around it. Routes stay thin: validate the input with zod (`parse`), check access (`requireAccountRole`), then call a plain function.
- Anything that parses, sorts, encrypts or checks permissions gets a small test next to it (`*.test.ts`).
- Write comments that say *why*, not what. If something is knowingly incomplete, mark it `shortcut: <the limit>, <when to upgrade>` so it's easy to find later.
- Run `npm test` and the typecheckers (`npx tsc` in `apps/server`, `npx tsc --noEmit` in `apps/web`) before opening a pull request.

## Security

Things to know as an admin:

- Every user can connect Nexus to mail servers and plugin services of their choosing, including addresses on your local network (that is how homelab services are reached). Only give accounts to people you trust with that.
- Plugins run with full access to Nexus. Install only ones you trust (see [docs/plugins.md](docs/plugins.md)).
- `MAIL_ALLOW_INSECURE_TLS=true` turns off certificate checks for every mail server. Use it only for a server on your own network.

Found a vulnerability? Please report it privately to ali@azam.email instead of opening a public issue.
