// Signing in, and creating the first (admin) account on a new server.
import { useQueryClient } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Button, Field, Input, Logo } from '../components/ui'
import { api } from '../lib/api'
import { signInWithPasskey } from '../lib/passkeys'
import { useServerStatus } from '../lib/queries'

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="grid min-h-full place-items-center bg-ground px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <Logo size={52} />
          <div>
            <h1 className="text-[22px] font-bold tracking-tight">{title}</h1>
            <p className="mt-1 text-muted">{subtitle}</p>
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-panel p-6 shadow-pop">{children}</div>
      </div>
    </main>
  )
}

export function LoginPage() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const status = useServerStatus()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // The very first visitor sets up the server and becomes its admin.
  const signingUp = status.data?.needsSetup || mode === 'signup'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>
    setBusy(true)
    setError('')
    try {
      if (signingUp) {
        await api('/auth/signup', { body: form })
        await client.invalidateQueries({ queryKey: ['me'] })
        navigate('/mail/inbox')
      } else {
        const result = await api<{ twoFactorRequired: boolean }>('/auth/login', { body: form })
        await client.invalidateQueries({ queryKey: ['me'] })
        navigate(result.twoFactorRequired ? '/login/2fa' : '/mail/inbox')
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function passkey() {
    setError('')
    try {
      await signInWithPasskey()
      await client.invalidateQueries({ queryKey: ['me'] })
      navigate('/mail/inbox')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const firstVisit = status.data?.needsSetup
  let title = 'Sign in to Nexus'
  if (firstVisit) title = 'Welcome to Nexus'
  else if (signingUp) title = 'Create your account'

  return (
    <AuthLayout
      title={title}
      subtitle={firstVisit ? 'Create the admin account for this server.' : 'Your mail, on your server.'}
    >
      <form onSubmit={submit} className="grid gap-4">
        {signingUp && (
          <Field label="Your name">
            <Input name="name" autoComplete="name" required autoFocus />
          </Field>
        )}
        <Field label="Email">
          <Input
            name="email"
            type="email"
            autoComplete="username"
            placeholder="you@example.com"
            required
            autoFocus={!signingUp}
          />
        </Field>
        <Field label="Password" hint={signingUp ? 'At least 12 characters.' : undefined}>
          <Input
            name="password"
            type="password"
            autoComplete={signingUp ? 'new-password' : 'current-password'}
            minLength={signingUp ? 12 : undefined}
            required
          />
        </Field>
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" className="py-2.5" disabled={busy || status.isLoading}>
          {signingUp ? 'Create account' : 'Sign in'}
        </Button>
        {!signingUp && (
          <Button onClick={passkey} className="py-2.5">
            <KeyRound size={15} /> Sign in with a passkey
          </Button>
        )}
        {status.data?.allowSignup && !status.data.needsSetup && (
          <button
            type="button"
            className="text-[13px] text-accent-text hover:underline"
            onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
          >
            {mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}
          </button>
        )}
      </form>
    </AuthLayout>
  )
}
