import * as openpgp from 'openpgp'
import { describe, expect, it } from 'vitest'
import { decrypt, encryptText, fingerprintOf, generateKey, importPrivateKey, signText } from './pgp'

const unlock = async (armored: string, passphrase: string) =>
  openpgp.decryptKey({ privateKey: await openpgp.readPrivateKey({ armoredKey: armored }), passphrase })

describe('PGP', () => {
  it('creates a passphrase-locked key that GnuPG-style tools can read', async () => {
    const key = await generateKey('Ali Azam', 'ali@azam.email', 'a long passphrase')
    expect(key.userIds).toEqual(['Ali Azam <ali@azam.email>'])
    expect(key.fingerprint).toBe(await fingerprintOf(key.publicKey))
    const stored = await openpgp.readPrivateKey({ armoredKey: key.encryptedPrivateKey })
    expect(stored.isDecrypted()).toBe(false) // never stored unlocked
    await expect(unlock(key.encryptedPrivateKey, 'wrong')).rejects.toThrow()
  })

  it('round-trips an encrypted, signed message', async () => {
    const alice = await generateKey('Alice', 'alice@example.com', 'alice pass')
    const bob = await generateKey('Bob', 'bob@example.com', 'bob pass')
    const armored = await encryptText(
      'Hello Bob',
      [bob.publicKey],
      await unlock(alice.encryptedPrivateKey, 'alice pass'),
    )
    expect(armored).toContain('-----BEGIN PGP MESSAGE-----')
    expect(armored).not.toContain('Hello Bob')
    expect(await decrypt(armored, await unlock(bob.encryptedPrivateKey, 'bob pass'))).toBe('Hello Bob')
  })

  it('signs in clear text', async () => {
    const key = await generateKey('Ali', 'ali@azam.email', 'pass phrase')
    const signed = await signText('Hi', await unlock(key.encryptedPrivateKey, 'pass phrase'))
    expect(signed).toContain('-----BEGIN PGP SIGNED MESSAGE-----')
  })

  it('locks an imported unprotected key with the passphrase, and refuses a wrong one for a protected key', async () => {
    const { privateKey } = await openpgp.generateKey({
      type: 'ecc',
      curve: 'curve25519Legacy',
      userIDs: [{ email: 'x@y.z' }],
      format: 'armored',
    })
    const imported = await importPrivateKey(privateKey, 'new passphrase')
    expect((await openpgp.readPrivateKey({ armoredKey: imported.encryptedPrivateKey })).isDecrypted()).toBe(false)
    await expect(importPrivateKey(imported.encryptedPrivateKey, 'wrong')).rejects.toThrow('does not unlock')
  })
})
