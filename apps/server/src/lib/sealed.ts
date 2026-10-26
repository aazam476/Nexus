// Private storage: mail sealed so that only its owner's password can open it.
//
// Each user has an X25519 key pair. New mail is sealed to the public key, so background sync can
// store mail while the user is signed out. The private key is kept locked twice over:
//   - in User, with a key derived from the user's password (scrypt)
//   - in Session, with a key derived from that session's cookie token (only the browser has it)
// A database dump alone therefore opens nothing.
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  scrypt,
  type KeyObject,
} from 'node:crypto'
import { promisify } from 'node:util'

const VERSION = 1
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: object,
) => Promise<Buffer>

export interface StorageKeys {
  publicKey: string // base64 SPKI
  privateKey: KeyObject
}

export function newStorageKeys(): StorageKeys {
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  return { publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), privateKey }
}

// ---------- Sealing data to a public key (ECIES: X25519 + HKDF-SHA256 + AES-256-GCM) ----------
// Layout: [version 1][ephemeral public key 44][iv 12][tag 16][ciphertext]

export function seal(data: Buffer, publicKeyBase64: string): Buffer {
  const ephemeral = generateKeyPairSync('x25519')
  const recipient = createPublicKey({ key: Buffer.from(publicKeyBase64, 'base64'), format: 'der', type: 'spki' })
  const key = derive(diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient }))
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(data), cipher.final()])
  const ephemeralPublic = ephemeral.publicKey.export({ type: 'spki', format: 'der' })
  return Buffer.concat([Buffer.from([VERSION]), ephemeralPublic, iv, cipher.getAuthTag(), body])
}

export function unseal(sealed: Buffer, privateKey: KeyObject): Buffer {
  if (sealed[0] !== VERSION) throw new Error('Unknown sealed format')
  const ephemeral = createPublicKey({ key: sealed.subarray(1, 45), format: 'der', type: 'spki' })
  const key = derive(diffieHellman({ privateKey, publicKey: ephemeral }))
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(45, 57))
  decipher.setAuthTag(sealed.subarray(57, 73))
  return Buffer.concat([decipher.update(sealed.subarray(73)), decipher.final()])
}

const derive = (shared: Buffer) => Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), 'nexus-sealed-v1', 32))

export const sealJson = (value: unknown, publicKey: string) => seal(Buffer.from(JSON.stringify(value)), publicKey)
export const unsealJson = <T>(sealed: Uint8Array, privateKey: KeyObject): T =>
  JSON.parse(unseal(Buffer.from(sealed), privateKey).toString())

// ---------- Locking the private key ----------
// Stored as "salt.iv.tag.data" (base64). The salt is empty for session locks, which use a random token.

function lockWith(privateKey: KeyObject, key: Buffer, salt: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const der = privateKey.export({ type: 'pkcs8', format: 'der' })
  const data = Buffer.concat([cipher.update(der), cipher.final()])
  return [salt, iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.')
}

function unlockWith(locked: string, keyFor: (salt: Buffer) => Buffer | Promise<Buffer>): Promise<KeyObject> {
  const [salt, iv, tag, data] = locked.split('.').map((part) => Buffer.from(part, 'base64'))
  return Promise.resolve(keyFor(salt)).then((key) => {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const der = Buffer.concat([decipher.update(data), decipher.final()])
    return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  })
}

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const passwordKey = (password: string, salt: Buffer) => scryptAsync(password, salt, 32, SCRYPT)
const tokenKey = (token: string) => Buffer.from(hkdfSync('sha256', token, Buffer.alloc(0), 'nexus-session-key-v1', 32))

export async function lockWithPassword(privateKey: KeyObject, password: string): Promise<string> {
  const salt = randomBytes(16)
  return lockWith(privateKey, await passwordKey(password, salt), salt)
}

// Throws when the password is wrong (the GCM tag won't match).
export const unlockWithPassword = (locked: string, password: string) =>
  unlockWith(locked, (salt) => passwordKey(password, salt))

export const lockWithToken = (privateKey: KeyObject, token: string) =>
  lockWith(privateKey, tokenKey(token), Buffer.alloc(0))
export const unlockWithToken = (locked: string, token: string) => unlockWith(locked, () => tokenKey(token))
