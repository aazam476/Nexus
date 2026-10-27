# Writing a Nexus plugin

A plugin connects Nexus to another service. It can do two things today:

- **save an attachment** somewhere (Immich, Nextcloud, Paperless, a webhook…), shown in the **Save to…** menu
- **create a calendar event** from a flight, booking or invite found in an email, shown on the event card

Admins add, delete and turn plugins on or off for everyone in **Settings → Admin**. Each user then turns a
plugin on for themself and fills in their own settings in **Settings → Plugins**. Settings are stored encrypted.

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

Either:

- **On the Admin page:** in **Settings → Admin → Plugins**, click **Add plugin** and pick the plugin's single
  `.js` or `.mjs` file. Nexus shows what a quick look at the code found and its fingerprint before you install it.
- **On the server:** copy the file or folder (for example [`examples/webhook-plugin`](examples/webhook-plugin))
  into the `plugins/` folder next to `docker-compose.yml`, and restart Nexus (`docker compose restart app`).
  The log says `Loaded plugin Webhook (webhook)`.

Then open **Settings → Plugins**, fill in its settings, and turn it on.

If a plugin fails to load, the log says why and Nexus starts without it. A deleted plugin's code stays in
memory, unused, until Nexus restarts. Built-in plugins ship with Nexus, so deleting one hides it instead
(with everyone's settings for it deleted), and the Admin page can restore it.

## Security

Plugins run inside the Nexus server with the same access as Nexus itself: they could read any mail.
Only install plugins you trust, exactly as you would any other server software, and read the code first.

The Admin page's check before installing points out code that runs programs, reads the server's settings,
talks to the database, reads files or hides code. It is a hint about what to read closely, not a guarantee:
well-hidden code can get past it. Because admins can install plugins, an admin account can run code on the
server, so give admins strong passwords and two-factor sign-in.
