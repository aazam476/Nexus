// PGP, done entirely in the browser with openpgp.js. The server only ever sees public keys,
// the passphrase-locked private key, and encrypted text. Passphrases never leave this page.
import * as openpgp from 'openpgp'
import { api } from './api'

export interface StoredKey {
  id: string
  fingerprint: string
  userIds: string[]
  publicKey: string
  encryptedPrivateKey: string
  isDefault: boolean
  createdAt: string
}

// An unlocked key stays in memory until the tab closes, so the passphrase is asked once per visit.
let unlocked: openpgp.PrivateKey | null = null

export const isUnlocked = () => unlocked !== null

export async function defaultKey(): Promise<StoredKey | undefined> {
  const keys = await api<StoredKey[]>('/pgp/keys')
  return keys.find((k) => k.isDefault) ?? keys[0]
}

export async function unlock(passphrase: string): Promise<openpgp.PrivateKey> {
  if (unlocked) return unlocked
  const stored = await defaultKey()
  if (!stored) throw new Error('You have no PGP key yet. Create or import one in Settings → PGP & S/MIME.')
  const privateKey = await openpgp.readPrivateKey({ armoredKey: stored.encryptedPrivateKey })
  try {
    unlocked = await openpgp.decryptKey({ privateKey, passphrase })
  } catch {
    throw new Error('Wrong passphrase')
  }
  return unlocked
}

export async function decrypt(armored: string, key: openpgp.PrivateKey): Promise<string> {
  const message = await openpgp.readMessage({ armoredMessage: armored })
  const { data } = await openpgp.decrypt({ message, decryptionKeys: key })
  const text = String(data)
  // PGP/MIME wraps a whole MIME part; show its body rather than its headers.
  // shortcut: nested multipart content inside PGP/MIME is shown as raw text; parse it if people send rich encrypted mail.
  return /^content-type:/i.test(text)
    ? text
        .split(/\r?\n\r?\n/)
        .slice(1)
        .join('\n\n')
    : text
}

export async function encryptText(
  text: string,
  armoredPublicKeys: string[],
  signingKey?: openpgp.PrivateKey,
): Promise<string> {
  const encryptionKeys = await Promise.all(armoredPublicKeys.map((armoredKey) => openpgp.readKey({ armoredKey })))
  return openpgp.encrypt({
    message: await openpgp.createMessage({ text }),
    encryptionKeys,
    signingKeys: signingKey,
  }) as Promise<string>
}

export async function signText(text: string, key: openpgp.PrivateKey): Promise<string> {
  return openpgp.sign({ message: await openpgp.createCleartextMessage({ text }), signingKeys: key }) as Promise<string>
}

// Upload shape for POST /pgp/keys.
async function describe(publicArmored: string, privateArmored: string) {
  const key = await openpgp.readKey({ armoredKey: publicArmored })
  return {
    fingerprint: key.getFingerprint().toUpperCase(),
    userIds: key.getUserIDs(),
    publicKey: publicArmored,
    encryptedPrivateKey: privateArmored,
  }
}

export async function generateKey(name: string, email: string, passphrase: string) {
  // curve25519Legacy: the widely supported flavour that GnuPG and other mail clients read.
  const { publicKey, privateKey } = await openpgp.generateKey({
    type: 'ecc',
    curve: 'curve25519Legacy',
    userIDs: [{ name, email }],
    passphrase,
    format: 'armored',
  })
  return describe(publicKey, privateKey)
}

// Accepts an exported private key. If it isn't passphrase-protected yet, it is locked with `passphrase` first.
export async function importPrivateKey(armored: string, passphrase: string) {
  let privateKey = await openpgp.readPrivateKey({ armoredKey: armored })
  if (privateKey.isDecrypted()) {
    privateKey = await openpgp.encryptKey({ privateKey, passphrase })
  } else {
    await openpgp.decryptKey({ privateKey, passphrase }).catch(() => {
      throw new Error('That passphrase does not unlock this key')
    })
  }
  return describe(privateKey.toPublic().armor(), privateKey.armor())
}

export async function fingerprintOf(armoredPublicKey: string): Promise<string> {
  return (await openpgp.readKey({ armoredKey: armoredPublicKey })).getFingerprint().toUpperCase()
}

export const formatFingerprint = (fingerprint: string) => fingerprint.replace(/(.{4})/g, '$1 ').trim()
