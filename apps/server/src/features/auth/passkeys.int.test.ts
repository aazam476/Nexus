// Passkeys on the server: the refusals. The full sign-in with a (pretend) passkey runs in the
// browser tests (web/e2e/passkeys.spec.ts), because it needs a browser to play the passkey.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Browser, signedInUser, startApp } from '../../test/helpers.ts'

let app: Awaited<ReturnType<typeof startApp>>
beforeAll(async () => {
  app = await startApp()
})
afterAll(() => app.close())

// What a browser would send back, signed with a challenge, by a passkey Nexus has never seen.
const fakeResponse = (challenge: string) => ({
  id: 'unknown-passkey',
  rawId: 'unknown-passkey',
  type: 'public-key',
  clientExtensionResults: {},
  response: {
    clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge })).toString('base64url'),
    authenticatorData: '',
    signature: '',
  },
})

describe('passkeys', () => {
  it('uses each challenge once, and refuses passkeys nobody added', async () => {
    const browser = new Browser(app)
    const { challenge } = await browser.json<{ challenge: string }>('POST', '/api/auth/passkeys/sign-in/options', {})
    const first = await browser.post('/api/auth/passkeys/sign-in', { response: fakeResponse(challenge) })
    expect(first.json().error).toMatch(/isn’t known here/)
    const again = await browser.post('/api/auth/passkeys/sign-in', { response: fakeResponse(challenge) })
    expect(again.json().error).toMatch(/already used/)
    const madeUp = await browser.post('/api/auth/passkeys/sign-in', { response: fakeResponse('made-up') })
    expect(madeUp.statusCode).toBe(401)
  })

  it('keeps a challenge to what it was made for', async () => {
    const { browser } = await signedInUser(app)
    // A challenge made for adding a passkey can't sign anyone in.
    const { challenge } = await browser.json<{ challenge: string }>('POST', '/api/auth/passkeys/options', {
      kind: 'passkey',
    })
    const refused = await new Browser(app).post('/api/auth/passkeys/sign-in', { response: fakeResponse(challenge) })
    expect(refused.json().error).toMatch(/already used/)
  })

  it('needs a password first for the second step, and a passkey to use', async () => {
    expect((await new Browser(app).post('/api/auth/passkeys/second-step/options', {})).statusCode).toBe(401)
    const { browser } = await signedInUser(app)
    expect((await browser.post('/api/auth/passkeys/1/storage/options', {})).json().error).toMatch(
      /haven’t added a passkey/,
    )
    expect(await browser.json('GET', '/api/auth/passkeys')).toEqual([])
  })
})
