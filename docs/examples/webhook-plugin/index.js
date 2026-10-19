// Example Nexus plugin: sends attachments and calendar events to any URL as a webhook.
// Copy this folder into Nexus's plugins/ folder and restart Nexus to try it.

/** @type {import('../../../apps/server/src/plugins/types.ts').NexusPlugin} */
export default {
  id: 'webhook',
  name: 'Webhook',
  description: 'POST attachments and events to a URL of your choice (n8n, Node-RED, Home Assistant…).',
  author: 'Your name',
  settings: [
    { key: 'url', label: 'Webhook URL', type: 'url', placeholder: 'https://n8n.example.com/webhook/nexus', required: true },
    { key: 'secret', label: 'Shared secret (sent as X-Nexus-Secret)', type: 'password' },
  ],

  async testConnection(settings) {
    const response = await fetch(settings.url, { method: 'POST', headers: headers(settings), body: JSON.stringify({ type: 'test' }) })
    if (!response.ok) throw new Error(`The webhook answered ${response.status}`)
  },

  async saveAttachment(file, settings) {
    const response = await fetch(settings.url, {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify({ type: 'attachment', filename: file.filename, contentType: file.contentType, content: file.content.toString('base64') }),
    })
    if (!response.ok) throw new Error(`The webhook answered ${response.status}`)
    return {}
  },

  async createEvent(event, settings) {
    const response = await fetch(settings.url, { method: 'POST', headers: headers(settings), body: JSON.stringify({ type: 'event', event }) })
    if (!response.ok) throw new Error(`The webhook answered ${response.status}`)
    return {}
  },
}

function headers(settings) {
  return { 'content-type': 'application/json', ...(settings.secret && { 'x-nexus-secret': settings.secret }) }
}
