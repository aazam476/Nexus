// Rules, blocked senders and labels. (How rules sort incoming mail is tested in mail.int.test.ts
// and, rule by rule, in sorting.test.ts.)
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { signedInUser, startApp } from '../../test/helpers.ts'

let app: Awaited<ReturnType<typeof startApp>>
beforeAll(async () => {
  app = await startApp()
})
afterAll(() => app.close())

describe('rules', () => {
  it('adds rules in order, edits, turns off and deletes them', async () => {
    const { browser } = await signedInUser(app)
    const first = await browser.json('POST', '/api/rules', {
      name: 'Shop',
      field: 'from',
      contains: 'shop.test',
      action: 'move',
      value: 'archive',
    })
    const second = await browser.json('POST', '/api/rules', {
      name: 'Read',
      field: 'subject',
      contains: 'digest',
      action: 'mark-read',
    })
    expect([first.position, second.position]).toEqual([0, 1])

    await browser.json('PATCH', `/api/rules/${first.id}`, { enabled: false, contains: 'store.test' })
    expect((await browser.json('GET', '/api/rules'))[0]).toMatchObject({ enabled: false, contains: 'store.test' })
    expect((await browser.patch('/api/rules/not-mine', { enabled: false })).statusCode).toBe(404)

    await browser.json('DELETE', `/api/rules/${first.id}`)
    expect((await browser.json('GET', '/api/rules')).map((r: { name: string }) => r.name)).toEqual(['Read'])
  })

  it('creates the label a rule adds, so it shows in the sidebar', async () => {
    const { browser } = await signedInUser(app)
    await browser.json('POST', '/api/rules', {
      name: 'Invoices',
      field: 'subject',
      contains: 'invoice',
      action: 'label',
      value: 'Receipts',
    })
    expect((await browser.json('GET', '/api/labels')).map((l: { name: string }) => l.name)).toEqual(['Receipts'])
  })

  it('rejects rules with unknown fields or actions', async () => {
    const { browser } = await signedInUser(app)
    expect(
      (await browser.post('/api/rules', { name: 'x', field: 'cc', contains: 'a', action: 'label' })).statusCode,
    ).toBe(400)
    expect(
      (await browser.post('/api/rules', { name: 'x', field: 'from', contains: 'a', action: 'forward' })).statusCode,
    ).toBe(400)
  })
})

describe('blocked senders', () => {
  it('blocks an address or a whole domain, and unblocks it', async () => {
    const { browser } = await signedInUser(app)
    await browser.json('POST', '/api/blocked', { pattern: 'Pest@Annoying.test' })
    await browser.json('POST', '/api/blocked', { pattern: '@spam.test' })
    await browser.json('POST', '/api/blocked', { pattern: 'spam.test' }) // already there
    expect((await browser.json<string[]>('GET', '/api/blocked')).sort()).toEqual(['pest@annoying.test', 'spam.test'])
    expect((await browser.post('/api/blocked', { pattern: 'nodot' })).statusCode).toBe(400)

    await browser.json('DELETE', '/api/blocked/spam.test')
    expect(await browser.json('GET', '/api/blocked')).toEqual(['pest@annoying.test'])
  })
})

describe('labels', () => {
  it('creates, recolours and deletes labels', async () => {
    const { browser } = await signedInUser(app)
    await browser.json('PUT', '/api/labels', { name: 'Travel', color: '#f5b544' })
    await browser.json('PUT', '/api/labels', { name: 'Travel', color: '#123456' })
    expect(await browser.json('GET', '/api/labels')).toMatchObject([{ name: 'Travel', color: '#123456' }])
    expect((await browser.put('/api/labels', { name: 'Bad', color: 'blue' })).statusCode).toBe(400)

    await browser.json('DELETE', '/api/labels/Travel')
    expect(await browser.json('GET', '/api/labels')).toEqual([])
  })
})
