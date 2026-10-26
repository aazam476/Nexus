// Nextcloud, over its standard WebDAV (Files) and CalDAV (Calendar) endpoints.
// Use an app password (Nextcloud → Settings → Security), not your main password.
import { randomUUID } from 'node:crypto'
import { request, trimUrl, type NexusPlugin, type PluginEvent, type PluginSettings } from './types.ts'

const connection = [
  { key: 'url', label: 'Server URL', type: 'url', placeholder: 'https://cloud.example.com', required: true },
  { key: 'username', label: 'Username', type: 'text', required: true },
  { key: 'appPassword', label: 'App password', type: 'password', required: true },
] as const

const auth = (s: PluginSettings) => ({
  authorization: `Basic ${Buffer.from(`${s.username}:${s.appPassword}`).toString('base64')}`,
})
const davPath = (...parts: string[]) =>
  parts
    .map((p) => p.split('/').filter(Boolean).map(encodeURIComponent).join('/'))
    .filter(Boolean)
    .join('/')

export const nextcloudFiles: NexusPlugin = {
  id: 'nextcloud-files',
  name: 'Nextcloud Files',
  description: 'Save any attachment to a folder in Nextcloud.',
  author: 'Nexus',
  settings: [...connection, { key: 'folder', label: 'Folder', type: 'text', placeholder: '/Email attachments' }],

  async testConnection(s) {
    await request(
      `${trimUrl(s.url)}/remote.php/dav/files/${encodeURIComponent(s.username)}/`,
      { method: 'PROPFIND', headers: { ...auth(s), depth: '0' } },
      'Nextcloud',
    )
  },

  async saveAttachment(file, s) {
    const folder = s.folder || '/Email attachments'
    const root = `${trimUrl(s.url)}/remote.php/dav/files/${encodeURIComponent(s.username)}`
    // Create each level of the folder; "already exists" (405) is fine.
    let path = ''
    for (const part of folder.split('/').filter(Boolean)) {
      path = davPath(path, part)
      const response = await fetch(`${root}/${path}`, { method: 'MKCOL', headers: auth(s) })
      if (!response.ok && response.status !== 405)
        throw new Error(`Nextcloud could not create ${folder}: ${response.status}`)
    }
    const target = `${root}/${davPath(folder, file.filename)}`
    await request(
      target,
      { method: 'PUT', headers: { ...auth(s), 'content-type': file.contentType }, body: new Uint8Array(file.content) },
      'Nextcloud',
    )
    return { url: `${trimUrl(s.url)}/apps/files/?dir=${encodeURIComponent(folder)}` }
  },
}

export const nextcloudCalendar: NexusPlugin = {
  id: 'nextcloud-calendar',
  name: 'Nextcloud Calendar',
  description: 'Add flights, bookings and invites found in email to a Nextcloud calendar.',
  author: 'Nexus',
  settings: [...connection, { key: 'calendar', label: 'Calendar', type: 'text', placeholder: 'personal' }],

  async testConnection(s) {
    await request(calendarUrl(s), { method: 'PROPFIND', headers: { ...auth(s), depth: '0' } }, 'Nextcloud Calendar')
  },

  async createEvent(event, s) {
    const uid = randomUUID()
    await request(
      `${calendarUrl(s)}${uid}.ics`,
      {
        method: 'PUT',
        headers: { ...auth(s), 'content-type': 'text/calendar; charset=utf-8' },
        body: toIcs(event, uid),
      },
      'Nextcloud Calendar',
    )
    return { url: `${trimUrl(s.url)}/apps/calendar` }
  },
}

const calendarUrl = (s: PluginSettings) =>
  `${trimUrl(s.url)}/remote.php/dav/calendars/${encodeURIComponent(s.username)}/${encodeURIComponent(s.calendar || 'personal')}/`

export function toIcs(event: PluginEvent, uid: string): string {
  const stamp = (iso: string) =>
    new Date(iso)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '')
  const text = (value: string) => value.replace(/([\\,;])/g, '\\$1').replace(/\n/g, '\\n')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Nexus//Mail//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(event.start)}`,
    `DTEND:${stamp(event.end)}`,
    `SUMMARY:${text(event.title)}`,
    event.location && `LOCATION:${text(event.location)}`,
    event.detail && `DESCRIPTION:${text(event.detail)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n')
}
