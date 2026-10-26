// Immich: save photo and video attachments into your library, optionally into an album.
import { createHash } from 'node:crypto'
import { request, trimUrl, type NexusPlugin } from './types.ts'

export const immich: NexusPlugin = {
  id: 'immich',
  name: 'Immich',
  description: 'Save photo and video attachments to your Immich library.',
  author: 'Nexus',
  settings: [
    { key: 'url', label: 'Server URL', type: 'url', placeholder: 'https://photos.example.com', required: true },
    { key: 'apiKey', label: 'API key', type: 'password', required: true },
    { key: 'album', label: 'Album (optional)', type: 'text', placeholder: 'From email' },
  ],

  async testConnection(settings) {
    await request(`${trimUrl(settings.url)}/api/users/me`, { headers: { 'x-api-key': settings.apiKey } }, 'Immich')
  },

  async saveAttachment(file, settings) {
    if (!/^(image|video)\//.test(file.contentType)) throw new Error('Immich only accepts photos and videos')
    const base = trimUrl(settings.url)

    // One call to the Immich API, returning its JSON answer.
    async function call<T>(path: string, method = 'GET', body?: FormData | object): Promise<T> {
      const headers: Record<string, string> = { 'x-api-key': settings.apiKey }
      let payload: FormData | string | undefined
      if (body instanceof FormData) payload = body
      else if (body) {
        headers['content-type'] = 'application/json'
        payload = JSON.stringify(body)
      }
      const response = await request(`${base}${path}`, { method, headers, body: payload }, 'Immich')
      return (await response.json()) as T
    }

    // 1. Upload the file.
    const now = new Date().toISOString()
    const form = new FormData()
    form.append('assetData', new Blob([new Uint8Array(file.content)], { type: file.contentType }), file.filename)
    // The same file uploaded twice gets the same id, so Immich can spot duplicates.
    form.append('deviceAssetId', `nexus-${createHash('sha1').update(file.content).digest('hex')}`)
    form.append('deviceId', 'nexus')
    form.append('fileCreatedAt', now)
    form.append('fileModifiedAt', now)
    const asset = await call<{ id: string }>('/api/assets', 'POST', form)

    // 2. If an album is set, add it there, creating the album the first time.
    if (settings.album) {
      type Album = { id: string; albumName: string }
      const albums = await call<Album[]>('/api/albums')
      const album =
        albums.find((a) => a.albumName === settings.album) ??
        (await call<Album>('/api/albums', 'POST', { albumName: settings.album }))
      await call(`/api/albums/${album.id}/assets`, 'PUT', { ids: [asset.id] })
    }
    return { url: `${base}/photos/${asset.id}` }
  },
}
