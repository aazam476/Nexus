# Nexus

An open-source, self-hosted email client: many accounts in one smart inbox, private by default, and plugged into the rest of your self-hosted stack (Immich, Nextcloud, Paperless).

**Status:** UI mock. The web app runs on demo data while the server is being built.

## Run the UI

```bash
npm install
npm run dev:web
```

Open http://localhost:5173. Press `?` for keyboard shortcuts.

## Layout

```
apps/web/          React + Vite + Tailwind web app
  src/pages/       one file per screen
  src/components/  shared UI pieces
  src/mock/        demo data (goes away when the API lands)
```
