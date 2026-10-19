import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button } from '../components/ui'
import { api } from '../lib/api'
import { AuthLayout } from './LoginPage'

const CODE_LENGTH = 6

export function TwoFactorPage() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''))
  const [useRecovery, setUseRecovery] = useState(false)
  const [error, setError] = useState('')
  const inputs = useRef<(HTMLInputElement | null)[]>([])

  async function verify(body: { code?: string; recoveryCode?: string }) {
    setError('')
    try {
      await api('/auth/2fa', { body })
      await client.invalidateQueries({ queryKey: ['me'] })
      navigate('/mail/inbox')
    } catch (e) {
      setError((e as Error).message)
      setDigits(Array(CODE_LENGTH).fill(''))
      inputs.current[0]?.focus()
    }
  }

  // Phones' one-time-code autofill (and fast typing) can put the whole code into one box, so spread it out.
  function setDigit(index: number, value: string) {
    const typed = value.replace(/\D/g, '').slice(-(CODE_LENGTH - index))
    const next = [...digits]
    if (typed.length <= 1) next[index] = typed
    else typed.split('').forEach((d, i) => { next[index + i] = d })
    setDigits(next)
    const last = Math.min(index + Math.max(typed.length, 1), CODE_LENGTH - 1)
    if (typed) inputs.current[last]?.focus()
    if (next.every(Boolean)) verify({ code: next.join('') })
  }

  function onKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace' && !digits[index] && index > 0) inputs.current[index - 1]?.focus()
  }

  function onPaste(event: ClipboardEvent) {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH)
    if (pasted.length === CODE_LENGTH) {
      event.preventDefault()
      setDigits(pasted.split(''))
      verify({ code: pasted })
    }
  }

  function submitRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    verify({ recoveryCode: String(new FormData(event.currentTarget).get('recoveryCode') ?? '') })
  }

  return (
    <AuthLayout title="Two-factor authentication" subtitle={useRecovery ? 'Enter one of your recovery codes.' : 'Enter the 6-digit code from your authenticator app.'}>
      {useRecovery ? (
        <form className="grid gap-4" onSubmit={submitRecovery}>
          <input
            name="recoveryCode"
            aria-label="Recovery code"
            placeholder="xxxxx-xxxxx"
            autoComplete="off"
            className="w-full rounded-lg border border-line bg-raise px-3 py-2.5 text-center text-[15px] tracking-widest focus:border-accent"
            autoFocus
          />
          <Button type="submit" variant="primary" className="py-2.5">Verify recovery code</Button>
        </form>
      ) : (
        <div className="flex justify-between gap-2" onPaste={onPaste}>
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={(el) => { inputs.current[index] = el }}
              value={digit}
              onChange={(e) => setDigit(index, e.target.value)}
              onKeyDown={(e) => onKeyDown(index, e)}
              inputMode="numeric"
              autoComplete={index === 0 ? 'one-time-code' : 'off'}
              aria-label={`Digit ${index + 1}`}
              autoFocus={index === 0}
              className="h-13 w-11 rounded-xl border border-line bg-raise text-center text-[22px] font-semibold focus:border-accent"
            />
          ))}
        </div>
      )}
      {error && <p role="alert" className="mt-4 text-[13px] text-danger">{error}</p>}
      <div className="mt-5 flex justify-between text-[13px]">
        <button type="button" className="text-accent-text hover:underline" onClick={() => { setUseRecovery(!useRecovery); setError('') }}>
          {useRecovery ? 'Use authenticator code' : 'Use a recovery code'}
        </button>
        <Link to="/login" className="text-muted hover:text-ink">Back</Link>
      </div>
    </AuthLayout>
  )
}
