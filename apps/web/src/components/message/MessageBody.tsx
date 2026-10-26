// The text of a message: its HTML (shown safely by SafeHtml), its plain text, or, for PGP-encrypted
// mail, a form to decrypt it right here in the browser.
import { KeyRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import * as pgp from '../../lib/pgp'
import type { Message } from '../../types'
import { SafeHtml } from '../SafeHtml'
import { Button, Input } from '../ui'
import { attachmentUrl } from './Attachments'

const plainTextStyle = 'max-w-[65ch] text-[15px] leading-relaxed break-words whitespace-pre-wrap text-ink-2'

export function MessageBody({ message }: { message: Message }) {
  if (message.security === 'pgp-encrypted') return <EncryptedBody message={message} />
  if (message.html) return <SafeHtml html={message.html} />
  if (message.text) return <div className={plainTextStyle}>{message.text}</div>
  return <p className="text-muted">This message has no text.</p>
}

// PGP decryption happens in the browser: the private key and passphrase never reach the server.
function EncryptedBody({ message }: { message: Message }) {
  const [plain, setPlain] = useState<string | null>(null) // the decrypted text, once decrypted
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // The encrypted text ("-----BEGIN PGP MESSAGE-----…") is either in the body itself (inline PGP)
  // or in an attached "encrypted.asc" part (PGP/MIME).
  async function encryptedText(): Promise<string> {
    if (message.text?.includes('-----BEGIN PGP MESSAGE-----')) return message.text
    const part = message.attachments.find(
      (a) => a.filename.toLowerCase().endsWith('.asc') || a.contentType === 'application/octet-stream',
    )
    if (!part) throw new Error('Could not find the encrypted part of this message')
    const response = await fetch(attachmentUrl(message.id, part, true))
    return response.text()
  }

  // Called from the form (with the passphrase typed in), or from the button when the key is already
  // unlocked from earlier in this session.
  async function decrypt(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    const passphrase = event ? String(new FormData(event.currentTarget).get('passphrase') ?? '') : ''
    setBusy(true)
    setError('')
    try {
      const key = await pgp.unlock(passphrase)
      setPlain(await pgp.decrypt(await encryptedText(), key))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (plain !== null) return <div className={plainTextStyle}>{plain}</div>

  return (
    <form onSubmit={decrypt} className="grid gap-3 rounded-2xl border border-line bg-panel p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-raise text-news">
          <KeyRound size={18} />
        </span>
        <div>
          <p className="font-semibold">This message is encrypted with PGP</p>
          <p className="text-[13px] text-muted">
            It is decrypted here in your browser. Your passphrase never leaves this device.
          </p>
        </div>
      </div>
      {pgp.isUnlocked() ? (
        <Button variant="primary" className="justify-self-start" onClick={() => decrypt()} disabled={busy}>
          Decrypt
        </Button>
      ) : (
        <div className="flex gap-2">
          <Input
            name="passphrase"
            type="password"
            placeholder="Key passphrase"
            aria-label="Key passphrase"
            autoComplete="off"
            required
          />
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Decrypting…' : 'Decrypt'}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </form>
  )
}
