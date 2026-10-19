import { describe, expect, it } from 'vitest'
import { decrypt, encrypt, hashPassword, setEncryptionSecret, verifyPassword } from './crypto.ts'

describe('passwords', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const stored = await hashPassword('correct horse battery staple')
    expect(stored.startsWith('scrypt$')).toBe(true)
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true)
    expect(await verifyPassword('wrong', stored)).toBe(false)
  })
})

describe('secrets at rest', () => {
  it('round-trips and uses a fresh IV each time', () => {
    setEncryptionSecret('a'.repeat(40))
    const a = encrypt('imap-password')
    const b = encrypt('imap-password')
    expect(a).not.toBe(b)
    expect(decrypt(a)).toBe('imap-password')
  })

  it('refuses tampered data', () => {
    setEncryptionSecret('a'.repeat(40))
    const [v, iv, tag, data] = encrypt('secret').split('.')
    const flipped = Buffer.from(data, 'base64')
    flipped[0] ^= 1
    expect(() => decrypt([v, iv, tag, flipped.toString('base64')].join('.'))).toThrow()
  })

  it('cannot be read with another APP_SECRET', () => {
    setEncryptionSecret('a'.repeat(40))
    const stored = encrypt('secret')
    setEncryptionSecret('b'.repeat(40))
    expect(() => decrypt(stored)).toThrow()
  })
})
