// Turning a message into PGP mail, in the browser, before it goes to the server.
// (S/MIME is done by the server instead; see server/features/send/smime.ts.)
import { api } from '../../lib/api'
import * as pgp from '../../lib/pgp'

interface Options {
  text: string // the message as plain text: PGP mail has no HTML
  recipients: string[] // To, Cc and Bcc together
  encrypt: boolean
  sign: boolean
  passphrase: string // unlocks your key, for signing
  hasFiles: boolean // attachments, or files from a forwarded message
}

// Returns the text to send instead: encrypted and/or signed. Throws with a readable reason if it can't.
export async function pgpText({ text, recipients, encrypt, sign, passphrase, hasFiles }: Options): Promise<string> {
  const signingKey = sign ? await pgp.unlock(passphrase) : undefined
  if (!encrypt) return pgp.signText(text, signingKey!)

  // Only the text gets encrypted here; attached files would go out readable, so refuse instead.
  if (hasFiles) {
    throw new Error(
      'PGP encryption covers the message text only. Remove the attachments, or use S/MIME for encrypted attachments.',
    )
  }

  // Every recipient needs a public key (saved on their contact).
  const { keys, ownKey } = await api<{ keys: Record<string, string | null>; ownKey: string | null }>(
    '/pgp/recipients',
    { body: { emails: recipients } },
  )
  const missing = recipients.filter((email) => !keys[email])
  if (missing.length) {
    throw new Error(`No PGP key for ${missing.join(', ')}. Add their key to the contact, or turn off encryption.`)
  }

  // Also encrypt to your own key, or you couldn't read your own copy in Sent.
  const publicKeys = [...Object.values(keys), ownKey].filter((key): key is string => !!key)
  return pgp.encryptText(text, publicKeys, signingKey)
}
