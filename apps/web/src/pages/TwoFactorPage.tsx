import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button } from '../components/ui'
import { AuthLayout } from './LoginPage'

const CODE_LENGTH = 6

export function TwoFactorPage() {
  const navigate = useNavigate()
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''))
  const [useRecovery, setUseRecovery] = useState(false)
  const inputs = useRef<(HTMLInputElement | null)[]>([])

  function setDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[index] = digit
    setDigits(next)
    if (digit && index < CODE_LENGTH - 1) inputs.current[index + 1]?.focus()
    if (next.every(Boolean)) navigate('/mail/inbox')
  }

  function onKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace' && !digits[index] && index > 0) inputs.current[index - 1]?.focus()
  }

  function onPaste(event: ClipboardEvent) {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH)
    if (pasted.length === CODE_LENGTH) {
      event.preventDefault()
      setDigits(pasted.split(''))
      navigate('/mail/inbox')
    }
  }

  return (
    <AuthLayout title="Two-factor authentication" subtitle="Enter the 6-digit code from your authenticator app.">
      {useRecovery ? (
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); navigate('/mail/inbox') }}>
          <input
            aria-label="Recovery code"
            placeholder="xxxx-xxxx-xxxx"
            className="w-full rounded-lg border border-line bg-raise px-3 py-2.5 text-center text-[15px] tracking-widest focus:border-accent focus:outline-none"
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
              className="h-13 w-11 rounded-xl border border-line bg-raise text-center text-[22px] font-semibold focus:border-accent focus:outline-none"
            />
          ))}
        </div>
      )}
      <div className="mt-5 flex justify-between text-[13px]">
        <button type="button" className="text-accent-text hover:underline" onClick={() => setUseRecovery(!useRecovery)}>
          {useRecovery ? 'Use authenticator code' : 'Use a recovery code'}
        </button>
        <Link to="/login" className="text-muted hover:text-ink">Back</Link>
      </div>
    </AuthLayout>
  )
}
