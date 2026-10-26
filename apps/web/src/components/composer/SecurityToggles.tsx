// The Encrypt and Sign switches. Which method is used (S/MIME or PGP) is decided by the composer.
import { Lock, ShieldCheck } from 'lucide-react'
import { Toggle } from '../ui'

interface Props {
  method: 'S/MIME' | 'PGP'
  encrypt: boolean
  sign: boolean
  onEncrypt: (on: boolean) => void
  onSign: (on: boolean) => void
}

export function SecurityToggles({ method, encrypt, sign, onEncrypt, onSign }: Props) {
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
