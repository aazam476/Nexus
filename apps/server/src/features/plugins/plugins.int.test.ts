// Plugins, against a fake Immich / Nextcloud / Paperless server running inside the test.
// The fake records every request, so the tests can check exactly what each plugin sent.
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db.ts'
import { decrypt } from '../../lib/crypto.ts'
import { loadExternalPlugins } from '../../plugins/registry.ts'
import { syncAccount } from '../mail/sync.ts'
import { addAccount, deliver, signedInUser, startApp } from '../../test/helpers.ts'

interface Seen { method: string; url: string; headers: IncomingMessage['headers']; body: string }

let app: Awaited<ReturnType<typeof startApp>>
let fake: Server
let fakeUrl = ''
let seen: Seen[] = []
let answer: (request: Seen) => { status?: number; json?: unknown } = () => ({})

beforeAll(async () => {
  app = await startApp()
  fake = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const record = { method: request.method!, url: request.url!, headers: request.headers, body: Buffer.concat(chunks).toString('utf8') }
      seen.push(record)
      const { status = 200, json = {} } = answer(record)
      response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json))
    })
  })
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve))
  fakeUrl = `http://127.0.0.1:${(fake.address() as { port: number }).port}`
})
beforeEach(() => {
  seen = []
  answer = () => ({})
})
afterAll(async () => {
  fake.close()
  await app.close()
})

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const flight = {
  '@context': 'http://schema.org', '@type': 'FlightReservation', reservationNumber: 'XYZ',
  reservationFor: { '@type': 'Flight', flightNumber: '7', airline: { iataCode: 'NX' }, departureAirport: { iataCode: 'OSL' }, arrivalAirport: { iataCode: 'LIS' }, departureTime: '2030-05-01T08:00:00Z', arrivalTime: '2030-05-01T12:00:00Z' },
}

// A user with a message holding a photo, a PDF and a flight booking.
async function userWithMail() {
  const { browser, user } = await signedInUser(app)
  const { id, email } = await addAccount(browser)
  await deliver(email, {
    subject: 'Trip',
    html: `<script type="application/ld+json">${JSON.stringify(flight)}</script><p>Trip</p>`,
    attachments: [{ filename: 'beach.png', content: PNG, contentType: 'image/png' }, { filename: 'ticket.pdf', content: '%PDF-1.4 ticket', contentType: 'application/pdf' }],
  })
  await syncAccount(id)
  const [message] = await browser.json<{ id: string; attachments: { id: string; filename: string }[] }[]>('GET', '/api/messages')
  const attachment = (name: string) => message.attachments.find((a) => a.filename === name)!.id
  return { browser, user, message, attachment }
}

describe('plugin settings', () => {
  it('lists the built-in plugins, needs required settings before turning on, and never sends passwords back', async () => {
    const { browser, user } = await userWithMail()
    const plugins = await browser.json<{ id: string; enabled: boolean; capabilities: string[] }[]>('GET', '/api/plugins')
    expect(plugins.map((p) => [p.id, p.capabilities])).toEqual(expect.arrayContaining([
      ['immich', ['save-attachment']],
      ['nextcloud-files', ['save-attachment']],
      ['nextcloud-calendar', ['create-event']],
      ['paperless', ['save-attachment']],
    ]))

    expect((await browser.put('/api/plugins/immich', { enabled: true })).json().error).toMatch(/Fill in Server URL, API key/)
    await browser.json('PUT', '/api/plugins/immich', { enabled: true, settings: { url: `${fakeUrl}/`, apiKey: 'secret-key' } })
    const immich = (await browser.json<{ id: string; settings: { key: string; value: string }[] }[]>('GET', '/api/plugins')).find((p) => p.id === 'immich')!
    expect(immich.settings.find((s) => s.key === 'apiKey')?.value).toBe('••••••••')

    // Saving the placeholder keeps the real key; settings are stored encrypted.
    await browser.json('PUT', '/api/plugins/immich', { settings: { apiKey: '••••••••', album: 'Mail' } })
    const row = await db.pluginSetting.findFirstOrThrow({ where: { userId: user.id, pluginId: 'immich' } })
    expect(row.settings).not.toContain('secret-key')
    expect(JSON.parse(decrypt(row.settings))).toEqual({ url: fakeUrl + '/', apiKey: 'secret-key', album: 'Mail' })
    expect((await browser.put('/api/plugins/nope', { enabled: true })).statusCode).toBe(404)
  })

  it('refuses to run a plugin that is turned off', async () => {
    const { browser, message, attachment } = await userWithMail()
    const response = await browser.post('/api/plugins/paperless/save-attachment', { messageId: message.id, attachmentId: attachment('ticket.pdf') })
    expect(response.json().error).toMatch(/turned off/)
  })
})

describe('Immich', () => {
  it('uploads a photo and adds it to the album, creating the album if needed', async () => {
    const { browser, message, attachment } = await userWithMail()
    await browser.json('PUT', '/api/plugins/immich', { enabled: true, settings: { url: fakeUrl, apiKey: 'k', album: 'From email' } })
    answer = (r) => (r.url === '/api/assets' ? { json: { id: 'asset-1' } } : r.method === 'POST' && r.url === '/api/albums' ? { json: { id: 'album-1', albumName: 'From email' } } : { json: [] })

    const result = await browser.json('POST', '/api/plugins/immich/save-attachment', { messageId: message.id, attachmentId: attachment('beach.png') })
    expect(result).toEqual({ url: `${fakeUrl}/photos/asset-1` })
    expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual(['POST /api/assets', 'GET /api/albums', 'POST /api/albums', 'PUT /api/albums/album-1/assets'])
    expect(seen[0].headers['x-api-key']).toBe('k')
    expect(seen[0].body).toContain('filename="beach.png"')
    expect(seen[3].body).toBe(JSON.stringify({ ids: ['asset-1'] }))
  })

  it('accepts only photos and videos, and reports server errors as the plugin’s', async () => {
    const { browser, message, attachment } = await userWithMail()
    await browser.json('PUT', '/api/plugins/immich', { enabled: true, settings: { url: fakeUrl, apiKey: 'k' } })
    const pdf = await browser.post('/api/plugins/immich/save-attachment', { messageId: message.id, attachmentId: attachment('ticket.pdf') })
    expect([pdf.statusCode, pdf.json().error]).toEqual([502, 'Immich: Immich only accepts photos and videos'])

    answer = () => ({ status: 401 })
    expect((await browser.post('/api/plugins/immich/test')).json().error).toBe('Immich: Immich rejected the credentials')
    answer = () => ({ status: 500, json: { message: 'disk full' } })
    expect((await browser.post('/api/plugins/immich/save-attachment', { messageId: message.id, attachmentId: attachment('beach.png') })).json().error).toMatch(/answered 500: .*disk full/)
  })
})

describe('Nextcloud', () => {
  it('Files: creates the folder level by level, then uploads the file with the app password', async () => {
    const { browser, message, attachment } = await userWithMail()
    await browser.json('PUT', '/api/plugins/nextcloud-files', { enabled: true, settings: { url: fakeUrl, username: 'ann', appPassword: 'app-pw', folder: '/Mail/2030 trips' } })
    answer = (r) => (r.method === 'MKCOL' && r.url.endsWith('/Mail') ? { status: 405 } : {}) // "Mail" already exists

    await browser.json('POST', '/api/plugins/nextcloud-files/save-attachment', { messageId: message.id, attachmentId: attachment('ticket.pdf') })
    expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual([
      'MKCOL /remote.php/dav/files/ann/Mail',
      'MKCOL /remote.php/dav/files/ann/Mail/2030%20trips',
      'PUT /remote.php/dav/files/ann/Mail/2030%20trips/ticket.pdf',
    ])
    expect(seen[2].headers.authorization).toBe(`Basic ${Buffer.from('ann:app-pw').toString('base64')}`)
    expect(seen[2].body).toBe('%PDF-1.4 ticket')

    await browser.json('POST', '/api/plugins/nextcloud-files/test')
    expect(seen.at(-1)).toMatchObject({ method: 'PROPFIND', url: '/remote.php/dav/files/ann/' })
  })

  it('Calendar: adds the flight from an email as an event', async () => {
    const { browser, message } = await userWithMail()
    await browser.json('PUT', '/api/plugins/nextcloud-calendar', { enabled: true, settings: { url: fakeUrl, username: 'ann', appPassword: 'pw', calendar: 'travel' } })
    await browser.json('POST', '/api/plugins/nextcloud-calendar/create-event', { messageId: message.id })
    const [put] = seen
    expect(put.method).toBe('PUT')
    expect(put.url).toMatch(/^\/remote\.php\/dav\/calendars\/ann\/travel\/[\w-]+\.ics$/)
    expect(put.body).toContain('SUMMARY:NX7 OSL → LIS')
    expect(put.body).toContain('DTSTART:20300501T080000Z')
  })
})

describe('Paperless', () => {
  it('sends a document in for filing, titled after the file', async () => {
    const { browser, message, attachment } = await userWithMail()
    await browser.json('PUT', '/api/plugins/paperless', { enabled: true, settings: { url: fakeUrl, token: 'tok' } })
    await browser.json('POST', '/api/plugins/paperless/save-attachment', { messageId: message.id, attachmentId: attachment('ticket.pdf') })
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/documents/post_document/' })
    expect(seen[0].headers.authorization).toBe('Token tok')
    expect(seen[0].body).toMatch(/name="title"\r\n\r\nticket\r\n/)
  })

  it('says when there is no such attachment or no event in the message', async () => {
    const { browser, message } = await userWithMail()
    await browser.json('PUT', '/api/plugins/paperless', { enabled: true, settings: { url: fakeUrl, token: 'tok' } })
    expect((await browser.post('/api/plugins/paperless/save-attachment', { messageId: message.id, attachmentId: '42' })).statusCode).toBe(404)
    expect((await browser.post('/api/plugins/paperless/create-event', { messageId: message.id })).json().error).toMatch(/can't create events/)
  })
})

describe('third-party plugins', () => {
  it('loads valid plugins from the plugins folder and skips everything else', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexus-plugins-'))
    try {
      const plugin = (id: string) => `export default { id: '${id}', name: 'Echo', description: 'Test', author: 'Test', settings: [], async saveAttachment(file) { return { url: 'echo://' + file.filename } } }`
      writeFileSync(join(dir, 'echo.mjs'), plugin('echo'))
      writeFileSync(join(dir, 'duplicate.mjs'), plugin('immich')) // clashes with a built-in plugin
      writeFileSync(join(dir, 'broken.js'), 'export default 42')
      writeFileSync(join(dir, 'README.md'), '# not a plugin')
      await loadExternalPlugins(dir)
      await loadExternalPlugins(join(dir, 'missing')) // no folder: nothing happens

      const { browser, message, attachment } = await userWithMail()
      const plugins = await browser.json<{ id: string; builtIn: boolean }[]>('GET', '/api/plugins')
      expect(plugins.filter((p) => !p.builtIn).map((p) => p.id)).toEqual(['echo'])

      await browser.json('PUT', '/api/plugins/echo', { enabled: true })
      expect(await browser.json('POST', '/api/plugins/echo/save-attachment', { messageId: message.id, attachmentId: attachment('beach.png') })).toEqual({ url: 'echo://beach.png' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
