import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Button, Field, Input, Logo } from '../components/ui'

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
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
  const [error, setError] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (!form.get('email') || !form.get('password')) {
      setError('Enter your email and password.')
      return
    }
    // Mock: every login asks for a 2FA code.
    navigate('/login/2fa')
  }

  return (
    <AuthLayout title="Sign in to Nexus" subtitle="Your mail, on your server.">
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <Field label="Email">
          <Input name="email" type="email" autoComplete="username" placeholder="you@example.com" autoFocus />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" />
        </Field>
        {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
        <Button type="submit" variant="primary" className="py-2.5">
          Sign in
        </Button>
      </form>
    </AuthLayout>
  )
}
