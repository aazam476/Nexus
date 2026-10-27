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
    expect(await decrypt(armored, await unlock(bob.encryptedPrivateKey, 'bob pass'))).toEqual({
      text: 'Hello Bob',
      html: null,
      attachments: [],
    })
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

describe('PGP/MIME', () => {
  it('reads a whole encrypted email part: its HTML, text and attachments', async () => {
    const bob = await generateKey('Bob', 'bob@example.com', 'bob pass')
    // What Thunderbird encrypts: a full MIME part, here with text, HTML and a file.
    const mimePart = [
      'Content-Type: multipart/mixed; boundary="outer"',
      '',
      '--outer',
      'Content-Type: multipart/alternative; boundary="inner"',
      '',
      '--inner',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Meet at noon',
      '--inner',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Meet at <b>noon</b></p>',
      '--inner--',
      '--outer',
      'Content-Type: text/plain; name="plan.txt"',
      'Content-Disposition: attachment; filename="plan.txt"',
      '',
      'Step one',
      '--outer--',
      '',
    ].join('\r\n')
    const armored = await encryptText(mimePart, [bob.publicKey])
    const mail = await decrypt(armored, await unlock(bob.encryptedPrivateKey, 'bob pass'))
    expect(mail.text?.trim()).toBe('Meet at noon')
    expect(mail.html).toContain('<b>noon</b>')
    expect(mail.attachments.map((a) => [a.filename, new TextDecoder().decode(a.content).trim()])).toEqual([
      ['plan.txt', 'Step one'],
    ])
  })
})
