import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, del, patch, put } from './api'

// Replaces fetch with one that records the request and answers with `status` and `body`.
function fakeServer(status: number, body: unknown, contentType = 'application/json') {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(contentType ? JSON.stringify(body) : null, {
      status,
      headers: contentType ? { 'content-type': contentType } : {},
    })
  })
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('api', () => {
  it('GETs by default and POSTs JSON when there is a body', async () => {
    const calls = fakeServer(200, { ok: true })
    expect(await api('/accounts')).toEqual({ ok: true })
    await api('/send', { body: { to: ['a@b.test'] } })
    expect(calls[0]).toMatchObject({ url: '/api/accounts', init: { method: 'GET', credentials: 'same-origin' } })
    expect(calls[1].init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"to":["a@b.test"]}',
    })
  })

  it('has short forms for PUT, PATCH and DELETE', async () => {
    const calls = fakeServer(200, {})
    await put('/labels', { name: 'x' })
    await patch('/messages/1', { unread: false })
    await del('/contacts/1')
    expect(calls.map((c) => c.init.method)).toEqual(['PUT', 'PATCH', 'DELETE'])
  })

  it('turns the server’s error into an ApiError with its message and status', async () => {
    fakeServer(403, { error: 'You need editor access to this account' })
    const error = (await api('/send', { body: {} }).catch((e) => e)) as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect([error.status, error.message]).toEqual([403, 'You need editor access to this account'])
  })

  it('still gives a useful error when the response is not JSON', async () => {
    fakeServer(502, null, '')
    await expect(api('/accounts')).rejects.toThrow('Request failed (502)')
  })
})
