// Passkeys and security keys in the browser. The server makes a challenge, the browser asks the
// passkey to sign it (a fingerprint, face, PIN or a tap on a YubiKey), and the server checks it.
// See server/features/auth/passkeys.ts for what each use is for.
import {
  bufferToBase64URLString,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import { api } from './api'

// Passkeys that support "PRF" turn this into a secret only they can produce, which can unlock
// private storage. The secret differs per passkey, so the input itself needn't be secret.
const PRF_INPUT = new TextEncoder().encode('Nexus private storage')

// Asks the server for a challenge, has a passkey sign it, and returns what to send back:
// the signed response, and the passkey's PRF secret when it gave one.
async function sign(optionsPath: string, askForSecret: boolean) {
  const options = await api<PublicKeyCredentialRequestOptionsJSON>(optionsPath, { body: {} })
  const response = await startAuthentication({
    optionsJSON: askForSecret
      ? // The extension's input must be bytes, which the JSON type doesn't allow for, hence the cast.
        ({ ...options, extensions: { prf: { eval: { first: PRF_INPUT } } } } as PublicKeyCredentialRequestOptionsJSON)
      : options,
  })
  const secret = (response.clientExtensionResults as { prf?: { results?: { first?: ArrayBuffer } } }).prf?.results
    ?.first
  // The secret is bytes, which JSON can't carry, so it travels on its own as text and is left out here.
  return {
    response: { ...response, clientExtensionResults: {} },
    prf: secret ? bufferToBase64URLString(secret) : undefined,
  }
}

export async function signInWithPasskey() {
  await api('/auth/passkeys/sign-in', { body: await sign('/auth/passkeys/sign-in/options', true) })
}

// The second step after a password, instead of an authenticator-app code.
export async function secondStepWithPasskey() {
  const { response } = await sign('/auth/passkeys/second-step/options', false)
  await api('/auth/passkeys/second-step', { body: { response } })
}

// Lets this passkey open private storage when signing in without the password.
export async function letPasskeyUnlockStorage(id: string) {
  const { response, prf } = await sign(`/auth/passkeys/${id}/storage/options`, true)
  if (!prf) throw new Error('This passkey can’t unlock private storage. Sign in with your password when using it.')
  await api(`/auth/passkeys/${id}/storage`, { body: { response, prf } })
}

export async function addPasskey(name: string) {
  const options = await api<PublicKeyCredentialCreationOptionsJSON>('/auth/passkeys/options', { body: {} })
  // Ask for PRF now: security keys like YubiKeys can only produce the secret later if asked when created.
  const response = await startRegistration({ optionsJSON: { ...options, extensions: { prf: {} } as never } })
  const added = await api<{ id: string; unlockStorage: boolean }>('/auth/passkeys', {
    body: { name, response: { ...response, clientExtensionResults: {} } },
  })
  // With private storage on, ask the passkey for its secret right away (one more touch or tap).
  if (added.unlockStorage) await letPasskeyUnlockStorage(added.id)
}
