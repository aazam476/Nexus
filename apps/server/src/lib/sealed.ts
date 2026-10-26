// Private storage: mail sealed so that only its owner's password can open it.
//
// The idea in plain words:
//   - Each user who turns private storage on gets a key pair: a public key and a private key.
//   - Anything sealed with the public key can only be opened with the private key. That lets
//     background sync seal new mail while the user is signed out (it only needs the public key).
//   - The private key is never stored as is. It is kept "locked" (encrypted) twice:
//       in the User row, locked with a key made from the user's password, and
//       in each Session row, locked with a key made from that session's cookie (only the browser has it).
//   - So someone with a copy of the database has neither the password nor a cookie, and opens nothing.
//
// The crypto, for those who want the names: X25519 key pairs, sealing with ECIES (a fresh one-time
// X25519 key per message, HKDF-SHA256 to turn the shared secret into a key, AES-256-GCM to encrypt),
// and scrypt or HKDF to make the locking keys. Everything comes from Node's built-in crypto module.
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from 'node:crypto'
import { keyFromPassword } from './crypto.ts'

export interface StorageKeys {
  publicKey: string // base64, stored in User.storagePublicKey
  privateKey: KeyObject
}

export function newStorageKeys(): StorageKeys {
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  return { publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), privateKey }
}

// ---------- Sealing data to a public key ----------
// A sealed value is one Buffer, laid out like this (sizes in bytes):
//   [format version: 1][one-time public key: 44][iv: 12][auth tag: 16][encrypted data: the rest]
const VERSION = 1
const KEY_START = 1
const IV_START = KEY_START + 44
const TAG_START = IV_START + 12
const DATA_START = TAG_START + 16

export function seal(data: Buffer, publicKeyBase64: string): Buffer {
  // A fresh key pair for this one message. Combining its private half with the recipient's public
  // key gives a secret that only the recipient can recreate later (from their private key and our public half).
  const oneTime = generateKeyPairSync('x25519')
  const recipient = createPublicKey({ key: Buffer.from(publicKeyBase64, 'base64'), format: 'der', type: 'spki' })
  const key = keyFromSharedSecret(diffieHellman({ privateKey: oneTime.privateKey, publicKey: recipient }))

  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()])
  const oneTimePublic = oneTime.publicKey.export({ type: 'spki', format: 'der' })
  return Buffer.concat([Buffer.from([VERSION]), oneTimePublic, iv, cipher.getAuthTag(), encrypted])
}

export function unseal(sealed: Buffer, privateKey: KeyObject): Buffer {
  if (sealed[0] !== VERSION) throw new Error('Unknown sealed format')
  const oneTimePublic = createPublicKey({ key: sealed.subarray(KEY_START, IV_START), format: 'der', type: 'spki' })
  const key = keyFromSharedSecret(diffieHellman({ privateKey, publicKey: oneTimePublic }))

  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(IV_START, TAG_START))
  // The auth tag makes decryption fail loudly if the data was changed or the key is wrong.
  decipher.setAuthTag(sealed.subarray(TAG_START, DATA_START))
  return Buffer.concat([decipher.update(sealed.subarray(DATA_START)), decipher.final()])
}

// The shared secret isn't a good encryption key as is; HKDF turns it into a proper 32-byte one.
function keyFromSharedSecret(shared: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), 'nexus-sealed-v1', 32))
}

export function sealJson(value: unknown, publicKey: string): Buffer {
  return seal(Buffer.from(JSON.stringify(value)), publicKey)
}

export function unsealJson<T>(sealed: Uint8Array, privateKey: KeyObject): T {
  return JSON.parse(unseal(Buffer.from(sealed), privateKey).toString())
}

// ---------- Locking the private key ----------
// A locked key is stored as text: "salt.iv.tag.data", each part base64.
// The salt is only used for password locks; session locks leave it empty.

function lock(privateKey: KeyObject, key: Buffer, salt: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const keyBytes = privateKey.export({ type: 'pkcs8', format: 'der' })
  const encrypted = Buffer.concat([cipher.update(keyBytes), cipher.final()])
  return [salt, iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64')).join('.')
}

function unlock(locked: string, key: Buffer): KeyObject {
  const [, iv, tag, encrypted] = splitLocked(locked)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag) // a wrong password or token makes this fail, so unlocking throws
  const keyBytes = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return createPrivateKey({ key: keyBytes, format: 'der', type: 'pkcs8' })
}

const splitLocked = (locked: string) => locked.split('.').map((part) => Buffer.from(part, 'base64'))

// Password locks use keyFromPassword (scrypt, see crypto.ts): slow on purpose, against guessing.

// Session tokens are already long and random, so a fast HKDF is enough.
const keyFromToken = (token: string) =>
  Buffer.from(hkdfSync('sha256', token, Buffer.alloc(0), 'nexus-session-key-v1', 32))

export async function lockWithPassword(privateKey: KeyObject, password: string): Promise<string> {
  const salt = randomBytes(16)
  return lock(privateKey, await keyFromPassword(password, salt), salt)
}

// Throws when the password is wrong.
export async function unlockWithPassword(locked: string, password: string): Promise<KeyObject> {
  const [salt] = splitLocked(locked)
  return unlock(locked, await keyFromPassword(password, salt))
}

export function lockWithToken(privateKey: KeyObject, token: string): string {
  return lock(privateKey, keyFromToken(token), Buffer.alloc(0))
}

export async function unlockWithToken(locked: string, token: string): Promise<KeyObject> {
  return unlock(locked, keyFromToken(token))
}
