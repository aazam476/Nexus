// Paperless-ngx: send PDFs and scans in for OCR and filing.
import { request, trimUrl, type NexusPlugin } from './types.ts'

export const paperless: NexusPlugin = {
  id: 'paperless',
  name: 'Paperless-ngx',
  description: 'Send PDFs and scans straight to Paperless for OCR and filing.',
  author: 'Team @ Nexus',
  settings: [
    { key: 'url', label: 'Server URL', type: 'url', placeholder: 'https://paperless.example.com', required: true },
    { key: 'token', label: 'API token', type: 'password', required: true },
  ],

  async testConnection(s) {
    await request(
      `${trimUrl(s.url)}/api/documents/?page_size=1`,
      { headers: { authorization: `Token ${s.token}` } },
      'Paperless',
    )
  },

  async saveAttachment(file, s) {
    const form = new FormData()
    form.append('document', new Blob([new Uint8Array(file.content)], { type: file.contentType }), file.filename)
    form.append('title', file.filename.replace(/\.[^.]+$/, ''))
    await request(
      `${trimUrl(s.url)}/api/documents/post_document/`,
      { method: 'POST', headers: { authorization: `Token ${s.token}` }, body: form },
      'Paperless',
    )
    return { url: `${trimUrl(s.url)}/documents` }
  },
}
