// Storing PGP keys. The encryption itself happens in the browser (see apps/web/src/lib/pgp.ts);
// the server keeps public keys and passphrase-locked private keys, and finds recipients' keys.
// S/MIME certificates are tested with sending, in send.int.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { signedInUser, startApp } from '../../test/helpers.ts'

let app: Awaited<ReturnType<typeof startApp>>
beforeAll(async () => {
  app = await startApp()
})
afterAll(() => app.close())

const key = (fingerprint: string) => ({
  fingerprint,
  userIds: ['Test <test@nexus.test>'],
  publicKey: `-----BEGIN PGP PUBLIC KEY BLOCK-----\n${fingerprint}\n-----END PGP PUBLIC KEY BLOCK-----`,
  encryptedPrivateKey: '-----BEGIN PGP PRIVATE KEY BLOCK-----\nlocked\n-----END PGP PRIVATE KEY BLOCK-----',
})

describe('PGP keys', () => {
  it('makes the first key the default, and switches the default', async () => {
    const { browser } = await signedInUser(app)
    const first = await browser.json('POST', '/api/pgp/keys', key('a'.repeat(40)))
    const second = await browser.json('POST', '/api/pgp/keys', key('b'.repeat(40)))
    expect([first.isDefault, second.isDefault]).toEqual([true, false])
    expect(first.fingerprint).toBe('A'.repeat(40))

    await browser.json('POST', `/api/pgp/keys/${second.id}/default`)
    const keys = await browser.json<{ id: string; isDefault: boolean }[]>('GET', '/api/pgp/keys')
    expect(keys.map((k) => [k.id, k.isDefault])).toEqual([
      [first.id, false],
      [second.id, true],
    ])

    await browser.json('DELETE', `/api/pgp/keys/${first.id}`)
    expect(await browser.json('GET', '/api/pgp/keys')).toHaveLength(1)
  })

  it('refuses something that is not a PGP key', async () => {
    const { browser } = await signedInUser(app)
    expect((await browser.post('/api/pgp/keys', { ...key('a'.repeat(40)), publicKey: 'hello' })).statusCode).toBe(400)
    expect((await browser.post('/api/pgp/keys', key('not hex'))).statusCode).toBe(400)
  })

  it('finds the keys to encrypt to: contacts’ keys, plus your own so you can read what you sent', async () => {
    const { browser } = await signedInUser(app)
    await browser.json('POST', '/api/pgp/keys', key('c'.repeat(40)))
    await browser.json('POST', '/api/contacts', {
      name: 'Has key',
      emails: ['friend@x.test'],
      pgpPublicKey: 'FRIEND KEY',
    })
    const result = await browser.json('POST', '/api/pgp/recipients', { emails: ['Friend@x.test', 'stranger@x.test'] })
    expect(result).toEqual({
      keys: { 'friend@x.test': 'FRIEND KEY', 'stranger@x.test': null },
      ownKey: key('c'.repeat(40)).publicKey,
    })
  })
})
