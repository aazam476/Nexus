// The address book: adding, searching, editing, and vCard import/export. Each user only ever sees their own.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { signedInUser, startApp } from '../../test/helpers.ts'

let app: Awaited<ReturnType<typeof startApp>>
beforeAll(async () => {
  app = await startApp()
})
afterAll(() => app.close())

interface Contact { id: string; name: string; emails: string[]; phone: string | null; company: string | null }

describe('contacts', () => {
  it('adds, edits and removes a contact, checking the email addresses', async () => {
    const { browser } = await signedInUser(app)
    const created = await browser.json<Contact>('POST', '/api/contacts', { name: 'Grace Hopper', emails: ['Grace@Navy.test'], company: 'US Navy' })
    expect(created.emails).toEqual(['grace@navy.test'])
    expect((await browser.post('/api/contacts', { name: 'Bad', emails: ['not-an-email'] })).statusCode).toBe(400)
    expect((await browser.post('/api/contacts', { name: 'None', emails: [] })).statusCode).toBe(400)

    await browser.json('PATCH', `/api/contacts/${created.id}`, { phone: '+1 555 0100' })
    expect((await browser.json<Contact[]>('GET', '/api/contacts'))[0]).toMatchObject({ name: 'Grace Hopper', phone: '+1 555 0100' })

    await browser.json('DELETE', `/api/contacts/${created.id}`)
    expect(await browser.json('GET', '/api/contacts')).toEqual([])
  })

  it('finds contacts by part of a name, an address or a company', async () => {
    const { browser } = await signedInUser(app)
    await browser.json('POST', '/api/contacts', { name: 'Ada Lovelace', emails: ['ada@engines.test'], company: 'Analytical' })
    await browser.json('POST', '/api/contacts', { name: 'Alan Turing', emails: ['alan@bletchley.test'] })
    const search = async (q: string) => (await browser.json<Contact[]>('GET', `/api/contacts?q=${encodeURIComponent(q)}`)).map((c) => c.name)
    expect(await search('love')).toEqual(['Ada Lovelace'])
    expect(await search('bletchley')).toEqual(['Alan Turing'])
    expect(await search('ANALYTICAL')).toEqual(['Ada Lovelace'])
    expect(await search('nobody')).toEqual([])
  })

  it('keeps contacts private to each user', async () => {
    const owner = await signedInUser(app)
    const other = await signedInUser(app)
    const contact = await owner.browser.json<Contact>('POST', '/api/contacts', { name: 'Secret', emails: ['s@x.test'] })
    expect(await other.browser.json('GET', '/api/contacts')).toEqual([])
    expect((await other.browser.patch(`/api/contacts/${contact.id}`, { name: 'Mine' })).statusCode).toBe(404)
    await other.browser.json('DELETE', `/api/contacts/${contact.id}`)
    expect(await owner.browser.json('GET', '/api/contacts')).toHaveLength(1)
  })

  it('exports vCards, and importing merges into contacts with the same address', async () => {
    const { browser } = await signedInUser(app)
    await browser.json('POST', '/api/contacts', { name: 'Ada Lovelace', emails: ['ada@engines.test'] })

    const imported = await browser.json('POST', '/api/contacts/import', {
      vcf: [
        'BEGIN:VCARD', 'VERSION:3.0', 'FN:Ada L.', 'EMAIL:ada@engines.test', 'EMAIL:ada@home.test', 'TEL:+44 20 0000', 'END:VCARD',
        'BEGIN:VCARD', 'VERSION:3.0', 'FN:Charles Babbage', 'EMAIL:charles@engines.test', 'ORG:Difference Engines', 'END:VCARD',
      ].join('\r\n'),
    })
    expect(imported).toEqual({ added: 1 })
    const contacts = await browser.json<Contact[]>('GET', '/api/contacts')
    expect(contacts.map((c) => [c.name, c.emails, c.phone, c.company])).toEqual([
      ['Ada Lovelace', ['ada@engines.test', 'ada@home.test'], '+44 20 0000', null],
      ['Charles Babbage', ['charles@engines.test'], null, 'Difference Engines'],
    ])

    const exported = await browser.get('/api/contacts/export.vcf')
    expect(exported.headers['content-type']).toBe('text/vcard; charset=utf-8')
    expect(exported.body.match(/BEGIN:VCARD/g)).toHaveLength(2)
    expect(exported.body).toContain('EMAIL;TYPE=INTERNET:ada@home.test')
  })
})
