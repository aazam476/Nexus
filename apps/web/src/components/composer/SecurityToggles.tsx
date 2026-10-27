// The Encrypt and Sign switches. Which method is used (S/MIME or PGP) is decided by the composer.
import { Lock, ShieldCheck } from 'lucide-react'
import { Toggle } from '../ui'

interface Props {
  method: 'S/MIME' | 'PGP'
  available: boolean // false without a PGP key or an S/MIME certificate: then there's nothing to sign or encrypt with
  encrypt: boolean
  sign: boolean
  onEncrypt: (on: boolean) => void
  onSign: (on: boolean) => void
}

export function SecurityToggles({ method, available, encrypt, sign, onEncrypt, onSign }: Props) {
  if (!available)
    return (
      <span
        title="Create a PGP key or upload an S/MIME certificate in Settings → PGP & S/MIME"
        className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-[13px] text-muted"
      >
        <Lock size={14} /> No key to encrypt or sign
      </span>
    )
  return (
    <div className="flex items-center divide-x divide-line rounded-lg border border-line text-[13px] text-ink-2">
      <label className="flex items-center gap-2 px-3 py-1.5" title={`Encrypt with ${method}`}>
        <Lock size={14} className={encrypt ? 'text-news' : 'text-muted'} /> Encrypt
        <Toggle checked={encrypt} onChange={onEncrypt} label={`Encrypt with ${method}`} />
      </label>
      <label className="flex items-center gap-2 px-3 py-1.5" title={`Sign with ${method}`}>
        <ShieldCheck size={14} className={sign ? 'text-news' : 'text-muted'} /> Sign
        <Toggle checked={sign} onChange={onSign} label={`Sign with ${method}`} />
      </label>
      {(encrypt || sign) && <span className="px-2.5 py-1.5 text-[12px] text-muted">{method}</span>}
    </div>
  )
}
