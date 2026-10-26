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
    const headers = { 'x-api-key': settings.apiKey }
    const now = new Date().toISOString()

    const form = new FormData()
    form.append('assetData', new Blob([new Uint8Array(file.content)], { type: file.contentType }), file.filename)
    // Same file uploaded twice gets the same id, so Immich can recognise duplicates.
    form.append('deviceAssetId', `nexus-${createHash('sha1').update(file.content).digest('hex')}`)
    form.append('deviceId', 'nexus')
    form.append('fileCreatedAt', now)
    form.append('fileModifiedAt', now)
    const asset = (await (
      await request(`${base}/api/assets`, { method: 'POST', headers, body: form }, 'Immich')
    ).json()) as { id: string }

    if (settings.album) {
      const albums = (await (await request(`${base}/api/albums`, { headers }, 'Immich')).json()) as {
        id: string
        albumName: string
      }[]
      let album = albums.find((a) => a.albumName === settings.album)
      if (!album) {
        album = (await (
          await request(
            `${base}/api/albums`,
            {
              method: 'POST',
              headers: { ...headers, 'content-type': 'application/json' },
              body: JSON.stringify({ albumName: settings.album }),
            },
            'Immich',
          )
        ).json()) as { id: string; albumName: string }
      }
      await request(
        `${base}/api/albums/${album.id}/assets`,
        {
          method: 'PUT',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ ids: [asset.id] }),
        },
        'Immich',
      )
    }
    return { url: `${base}/photos/${asset.id}` }
  },
}
