// Settings → Password & 2FA: change password, two-factor sign-in, private storage, signed-in devices.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Laptop, Smartphone } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button, Card, Chip, Field, Input } from '../../components/ui'
import { api, del } from '../../lib/api'
import { timeAgo } from '../../lib/format'
import { useMe } from '../../lib/queries'

interface Session {
  id: string
  userAgent: string | null
  ip: string | null
  lastSeenAt: string
  current: boolean
}

// "Mozilla/5.0 (Macintosh…) … Firefox/131.0" -> "Firefox on macOS"
function describeDevice(agent: string | null) {
  if (!agent) return 'Unknown device'
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /Firefox\//.test(agent)
      ? 'Firefox'
      : /Chrome\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : 'Browser'
  const os = /iPhone|iPad/.test(agent)
    ? 'iOS'
    : /Android/.test(agent)
      ? 'Android'
      : /Mac OS X/.test(agent)
        ? 'macOS'
        : /Windows/.test(agent)
          ? 'Windows'
          : /Linux/.test(agent)
            ? 'Linux'
            : ''
  return os ? `${browser} on ${os}` : browser
}

export function SecuritySettings() {
  return (
    <>
      <PasswordCard />
      <TwoFactorCard />
      <PrivateStorageCard />
      <SessionsCard />
    </>
  )
}

function PasswordCard() {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    try {
      await api('/auth/password', { body: Object.fromEntries(new FormData(form)) })
      form.reset()
      setMessage({ ok: true, text: 'Password changed. Other devices were signed out.' })
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message })
    }
  }
  return (
    <Card title="Password">
      <form className="grid max-w-sm gap-3" onSubmit={submit}>
        <Field label="Current password">
          <Input name="current" type="password" autoComplete="current-password" required />
        </Field>
        <Field label="New password" hint="At least 12 characters.">
          <Input name="next" type="password" autoComplete="new-password" minLength={12} required />
        </Field>
        {message && (
          <p
            role={message.ok ? 'status' : 'alert'}
            className={`text-[13px] ${message.ok ? 'text-news' : 'text-danger'}`}
          >
            {message.text}
          </p>
        )}
        <Button type="submit" variant="primary" className="justify-self-start">
          Change password
        </Button>
      </form>
    </Card>
  )
}

function TwoFactorCard() {
  const me = useMe().data
  const client = useQueryClient()
  const [setup, setSetup] = useState<{ secret: string; qrCode: string } | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [asking, setAsking] = useState<'disable' | 'codes' | null>(null)
  const [error, setError] = useState('')
  const refreshMe = () => client.invalidateQueries({ queryKey: ['me'] })

  async function start() {
    setError('')
    setSetup(await api('/auth/2fa/setup', { body: {} }))
  }

  async function enable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const result = await api<{ recoveryCodes: string[] }>('/auth/2fa/enable', {
        body: { code: new FormData(event.currentTarget).get('code'), secret: setup!.secret },
      })
      setCodes(result.recoveryCodes)
      setSetup(null)
      refreshMe()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function confirmWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const password = new FormData(event.currentTarget).get('password')
    try {
      if (asking === 'disable') await api('/auth/2fa/disable', { body: { password } })
      else
        setCodes(
          (await api<{ recoveryCodes: string[] }>('/auth/2fa/recovery-codes', { body: { password } })).recoveryCodes,
        )
      setAsking(null)
      setError('')
      refreshMe()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Card
      title="Two-factor authentication"
      description="Ask for a code from an authenticator app every time you sign in."
      actions={<Chip color={me?.totpEnabled ? 'var(--news)' : 'var(--muted)'}>{me?.totpEnabled ? 'On' : 'Off'}</Chip>}
    >
      <div className="grid gap-4">
        {codes && (
          <div className="grid gap-3 rounded-xl border border-line bg-raise p-4">
            <p className="font-semibold">Save these recovery codes somewhere safe</p>
            <p className="text-[13px] text-muted">
              Each one signs you in once if you lose your phone. They won’t be shown again.
            </p>
            <ul className="grid grid-cols-2 gap-1 font-mono text-[13px] sm:grid-cols-5">
              {codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <Button className="justify-self-start" onClick={() => setCodes(null)}>
              I saved them
            </Button>
          </div>
        )}

        {setup ? (
          <div className="grid gap-5 sm:grid-cols-[180px_1fr]">
            <img
              src={setup.qrCode}
              alt="QR code for your authenticator app"
              className="w-full rounded-xl bg-white p-2"
            />
            <form className="grid content-start gap-3" onSubmit={enable}>
              <p>Scan this with your authenticator app, or enter the key by hand:</p>
              <code className="rounded-lg bg-raise px-3 py-2 font-mono text-[13px] tracking-wider break-all">
                {setup.secret.replace(/(.{4})/g, '$1 ') /* a space after every 4 characters, easier to type */}
              </code>
              <Field label="Code from the app">
                <Input
                  name="code"
                  inputMode="numeric"
                  placeholder="123 456"
                  autoComplete="one-time-code"
                  required
                  autoFocus
                />
              </Field>
              <div className="flex gap-2">
                <Button type="submit" variant="primary">
                  Verify and turn on
                </Button>
                <Button variant="ghost" onClick={() => setSetup(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        ) : asking ? (
          <form className="flex max-w-md flex-wrap items-end gap-2" onSubmit={confirmWithPassword}>
            <div className="min-w-0 flex-1">
              <Field label="Confirm with your password">
                <Input name="password" type="password" autoComplete="current-password" required autoFocus />
              </Field>
            </div>
            <Button type="submit" variant={asking === 'disable' ? 'danger' : 'primary'}>
              {asking === 'disable' ? 'Turn off 2FA' : 'New recovery codes'}
            </Button>
            <Button variant="ghost" onClick={() => setAsking(null)}>
              Cancel
            </Button>
          </form>
        ) : me?.totpEnabled ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={start}>Move to a new phone</Button>
            <Button onClick={() => setAsking('codes')}>New recovery codes</Button>
            <Button variant="danger" onClick={() => setAsking('disable')}>
              Turn off
            </Button>
            <span className="text-[12.5px] text-muted">{me.recoveryCodesLeft} recovery codes left</span>
          </div>
        ) : (
          <Button variant="primary" className="justify-self-start" onClick={start}>
            Set up two-factor authentication
          </Button>
        )}
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
      </div>
    </Card>
  )
}

function SessionsCard() {
  const client = useQueryClient()
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<Session[]>('/auth/sessions') }).data ?? []
  return (
    <Card title="Signed-in devices" description="Sign out anything you don’t recognise.">
      <ul className="divide-y divide-line">
        {sessions.map((s) => {
          const Icon = /iPhone|Android|Mobile/.test(s.userAgent ?? '') ? Smartphone : Laptop
          return (
            <li key={s.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-raise text-muted">
                <Icon size={17} />
              </span>
              <div className="flex-1">
                <p className="font-medium">{describeDevice(s.userAgent)}</p>
                <p className="text-[12.5px] text-muted">
                  {s.ip} · active {timeAgo(s.lastSeenAt)}
                </p>
              </div>
              {s.current ? (
                <Chip color="var(--news)">This device</Chip>
              ) : (
                <Button
                  variant="ghost"
                  onClick={() =>
                    del(`/auth/sessions/${s.id}`).then(() => client.invalidateQueries({ queryKey: ['sessions'] }))
                  }
                >
                  Sign out
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function PrivateStorageCard() {
  const me = useMe().data
  const client = useQueryClient()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const turningOn = !me?.privateStorage

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/auth/private-storage', {
        body: { enabled: turningOn, password: new FormData(event.currentTarget).get('password') },
      })
      setAsking(false)
      // The server encrypts (or decrypts) the stored mail in the background after answering.
      setNotice(
        turningOn
          ? 'On. Your stored mail is being encrypted in the background; a big mailbox takes a few minutes.'
          : 'Off. Your stored mail is being decrypted in the background.',
      )
      client.invalidateQueries()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title="Private storage"
      description="Encrypt your mail in Nexus’s database with a key only your password unlocks. Backups, database dumps and other admins can’t read it."
      actions={
        <Chip color={me?.privateStorage ? 'var(--news)' : 'var(--muted)'}>{me?.privateStorage ? 'On' : 'Off'}</Chip>
      }
    >
      <div className="grid gap-4">
        {turningOn && (
          <ul className="grid list-disc gap-1 pl-5 text-[13px] text-ink-2">
            <li>Search finds sender and subject, not words inside messages.</li>
            <li>Plugins and attachment saving work only while you’re signed in.</li>
            <li>If you forget your password, all your data will be lost.</li>
            <li>Not for POP3 accounts or accounts you share with others.</li>
            <li>Drafts and scheduled messages stay unencrypted until they’re sent.</li>
          </ul>
        )}
        {asking ? (
          <form className="flex max-w-md flex-wrap items-end gap-2" onSubmit={submit}>
            <div className="min-w-0 flex-1">
              <Field label="Confirm with your password">
                <Input name="password" type="password" autoComplete="current-password" required autoFocus />
              </Field>
            </div>
            <Button type="submit" variant={turningOn ? 'primary' : 'danger'} disabled={busy}>
              {turningOn ? 'Turn on' : 'Turn off'}
            </Button>
            <Button variant="ghost" onClick={() => setAsking(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <Button
            variant={turningOn ? 'primary' : 'secondary'}
            className="justify-self-start"
            onClick={() => setAsking(true)}
          >
            {turningOn ? 'Turn on private storage' : 'Turn off private storage'}
          </Button>
        )}
        {notice && (
          <p role="status" className="text-[13px] text-ink-2">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
      </div>
    </Card>
  )
}
