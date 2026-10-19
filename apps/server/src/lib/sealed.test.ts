import { describe, expect, it } from 'vitest'
import {
  lockWithPassword, lockWithToken, newStorageKeys, seal, sealJson, unlockWithPassword, unlockWithToken, unseal, unsealJson,
} from './sealed.ts'

describe('private storage', () => {
  it('seals to the public key and only the private key opens it', () => {
    const alice = newStorageKeys()
    const bob = newStorageKeys()
    const sealed = seal(Buffer.from('dear diary'), alice.publicKey)
    expect(sealed.includes(Buffer.from('dear diary'))).toBe(false)
    expect(unseal(sealed, alice.privateKey).toString()).toBe('dear diary')
    expect(() => unseal(sealed, bob.privateKey)).toThrow()
  })

  it('uses a fresh ephemeral key for every message', () => {
    const { publicKey } = newStorageKeys()
    expect(seal(Buffer.from('x'), publicKey).equals(seal(Buffer.from('x'), publicKey))).toBe(false)
  })

  it('refuses tampered data', () => {
    const keys = newStorageKeys()
    const sealed = seal(Buffer.from('hello'), keys.publicKey)
    sealed[sealed.length - 1] ^= 1
    expect(() => unseal(sealed, keys.privateKey)).toThrow()
  })

  it('round-trips JSON', () => {
    const keys = newStorageKeys()
    expect(unsealJson(sealJson({ a: 1, b: ['x'] }, keys.publicKey), keys.privateKey)).toEqual({ a: 1, b: ['x'] })
  })

  it('locks the private key with a password and with a session token', async () => {
    const keys = newStorageKeys()
    const byPassword = await lockWithPassword(keys.privateKey, 'correct horse')
    const reopened = await unlockWithPassword(byPassword, 'correct horse')
    const sealed = seal(Buffer.from('mail'), keys.publicKey)
    expect(unseal(sealed, reopened).toString()).toBe('mail')
    await expect(unlockWithPassword(byPassword, 'wrong')).rejects.toThrow()

    const bySession = lockWithToken(keys.privateKey, 'cookie-token')
    expect(unseal(sealed, await unlockWithToken(bySession, 'cookie-token')).toString()).toBe('mail')
    await expect(unlockWithToken(bySession, 'other-token')).rejects.toThrow()
  })
})
