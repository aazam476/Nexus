# Writing a Nexus plugin

A plugin connects Nexus to another service. It can do two things today:

- **save an attachment** somewhere (Immich, Nextcloud, Paperless, a webhook…), shown in the **Save to…** menu
- **create a calendar event** from a flight, booking or invite found in an email, shown on the event card

Each user turns plugins on and fills in their own settings in **Settings → Plugins**. Settings are stored encrypted.

## The shortest possible plugin

A plugin is one JavaScript file (or a folder with an `index.js`) whose default export looks like this:

```js
export default {
  id: 'my-plugin',              // lowercase, unique
  name: 'My plugin',
  description: 'One sentence shown in Settings.',
  author: 'Your name',
  settings: [
    { key: 'url', label: 'Server URL', type: 'url', required: true },
    { key: 'token', label: 'API token', type: 'password', required: true },
  ],

  async saveAttachment(file, settings) {
    // file: { filename, contentType, content }   content is a Buffer
    // settings: what the user typed, e.g. { url, token }
    // Throw an Error with a helpful message if something goes wrong; Nexus shows it to the user.
    return { url: 'https://where-it-went.example' } // optional link
  },
}
```

Optional methods:

| Method | When it is called |
|---|---|
| `saveAttachment(file, settings)` | the user picks your plugin in **Save to…** |
| `createEvent(event, settings)` | the user clicks **Add to …** on an event card. `event` is `{ title, start, end, location?, detail? }` with ISO dates |
| `testConnection(settings)` | the user clicks **Test connection** |

Only implement what makes sense; the UI only offers what your plugin can do.
The full types are in [`apps/server/src/plugins/types.ts`](../apps/server/src/plugins/types.ts), and the built-in plugins next to it are good real-world examples.

## Try it

1. Copy [`examples/webhook-plugin`](examples/webhook-plugin) into the `plugins/` folder next to `docker-compose.yml`.
2. Restart Nexus (`docker compose restart app`). The log says `Loaded plugin Webhook (webhook)`.
3. Open **Settings → Plugins**, fill in the URL, and turn it on.

If a plugin fails to load, the log says why and Nexus starts without it.

## Security

Plugins run inside the Nexus server with the same access as Nexus itself: they could read any mail.
Only install plugins you trust, exactly as you would any other server software, and read the code first.
