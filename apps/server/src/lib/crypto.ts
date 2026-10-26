// All cryptography the server does itself. Uses only Node's built-in crypto module.
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: object,
) => Promise<Buffer>

// ---------- Passwords ----------
// scrypt with a random salt. Stored as "scrypt$N$r$p$salt$hash" so parameters can change later.
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, 32, SCRYPT)
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, N, r, p, salt, hash] = stored.split('$')
  if (algorithm !== 'scrypt') return false
  const expected = Buffer.from(hash, 'base64')
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  })
  return timingSafeEqual(actual, expected)
}

// ---------- Secrets at rest ----------
// AES-256-GCM. The key is derived from APP_SECRET, so changing APP_SECRET makes stored secrets unreadable.
let key: Buffer | null = null

export function setEncryptionSecret(appSecret: string) {
  key = createHash('sha256').update(`nexus:${appSecret}`).digest()
}

export function encrypt(plain: string): string {
  if (!key) throw new Error('setEncryptionSecret() was not called')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.')
}

export function decrypt(stored: string): string {
  if (!key) throw new Error('setEncryptionSecret() was not called')
  const [version, iv, tag, data] = stored.split('.')
  if (version !== 'v1') throw new Error('Unknown secret format')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
}

// ---------- Tokens ----------

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
