// Settings → Mail accounts: add (Google, Microsoft or any IMAP/POP3 server), edit, sync and remove
// accounts, and set each one's signature.
import { useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { Button, Card, Chip, Field, Input } from '../../components/ui'
import { api, del, patch } from '../../lib/api'
import { timeAgo } from '../../lib/format'
import { sanitizeForEditor } from '../../lib/sanitize'
import { useAccounts } from '../../lib/queries'
import type { Account } from '../../types'

const authLabels = { password: 'Password', 'oauth-google': 'Google sign-in', 'oauth-microsoft': 'Microsoft sign-in' }

export function AccountsSettings() {
  const accounts = useAccounts().data ?? []
  const client = useQueryClient()
  const [params] = useSearchParams()
  const [adding, setAdding] = useState(accounts.length === 0)
  const refresh = () => {
    client.invalidateQueries({ queryKey: ['accounts'] })
    client.invalidateQueries({ queryKey: ['counts'] })
    client.invalidateQueries({ queryKey: ['messages'] })
  }

  return (
    <>
      {params.get('added') && <p role="status" className="rounded-xl border border-line bg-raise px-4 py-3">Account added. Your mail is syncing now.</p>}
      {params.get('error') && <p role="alert" className="rounded-xl border border-line bg-raise px-4 py-3 text-danger">Sign-in was cancelled: {params.get('error')}</p>}

      <Card
        title="Connected accounts"
        description="Every account appears in the unified inbox. Each has its own colour."
        actions={!adding && <Button variant="primary" onClick={() => setAdding(true)}><Plus size={15} /> Add account</Button>}
      >
        {accounts.length === 0 ? (
          <p className="text-muted">No accounts yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {accounts.map((account) => <AccountRow key={account.id} account={account} onChange={refresh} />)}
          </ul>
        )}
      </Card>

      {adding && <AddAccount onDone={() => { setAdding(false); refresh() }} onCancel={() => setAdding(false)} />}

      {accounts.some((a) => a.role !== 'viewer') && (
        <Card title="Signatures" description="Added to the end of new messages. Saved when you click away.">
          <div className="grid gap-4">
            {accounts.filter((a) => a.role !== 'viewer').map((account) => (
              <div key={account.id} className="grid gap-1.5">
                <span className="flex items-center gap-2 text-[12.5px] font-medium text-ink-2">
                  <i className="h-2 w-2 rounded-full" style={{ background: account.color }} />
                  {account.email}
                </span>
                {/* The user's own HTML, edited in place; the server and the mail sandbox treat it like any other mail content. */}
                <div
                  contentEditable
                  role="textbox"
                  aria-multiline="true"
                  aria-label={`Signature for ${account.email}`}
                  spellCheck
                  suppressContentEditableWarning
                  onBlur={(e) => { if (e.currentTarget.innerHTML !== account.signature) patch(`/accounts/${account.id}`, { signature: e.currentTarget.innerHTML }).then(refresh) }}
                  className="min-h-16 rounded-lg border border-line bg-raise px-3 py-2 text-[13.5px] focus:border-accent focus:outline-none"
                  dangerouslySetInnerHTML={{ __html: sanitizeForEditor(account.signature) }}
                />
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  )
}

function AccountRow({ account, onChange }: { account: Account; onChange: () => void }) {
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)

  async function sync() {
    setSyncing(true)
    await api(`/accounts/${account.id}/sync`, { body: {} }).catch((e) => setError(e.message))
    setTimeout(() => { setSyncing(false); onChange() }, 4000)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>
    try {
      await patch(`/accounts/${account.id}`, { name: form.name, color: form.color, ...(form.password && { password: form.password }) })
      setEditing(false)
      setError('')
      onChange()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function remove() {
    if (!confirm(`Remove ${account.email} from Nexus? Mail stays on your mail server.`)) return
    await del(`/accounts/${account.id}`)
    onChange()
  }

  return (
    <li className="grid gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-3">
        <i className="h-3 w-3 rounded-full" style={{ background: account.color }} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{account.email}</p>
          <p className="text-[12.5px] text-muted">
            {account.name} · {account.protocol.toUpperCase()} · {authLabels[account.auth]} · {account.lastSyncAt ? `synced ${timeAgo(account.lastSyncAt)}` : 'not synced yet'}
          </p>
          {account.syncError && <p className="text-[12.5px] text-danger">Sync failed: {account.syncError}</p>}
        </div>
        {account.role !== 'owner' && <Chip color="var(--people)">Shared with you · {account.role}</Chip>}
        <Button variant="ghost" title="Sync now" aria-label={`Sync ${account.email} now`} onClick={sync} disabled={syncing}>
          <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
        </Button>
        {account.role === 'owner' && <Button variant="secondary" onClick={() => setEditing(!editing)}>{editing ? 'Close' : 'Edit'}</Button>}
      </div>
      {editing && (
        <form onSubmit={save} className="grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-[1fr_90px]">
          <Field label="Display name"><Input name="name" defaultValue={account.name} required /></Field>
          <Field label="Colour"><input name="color" type="color" defaultValue={account.color} aria-label="Account colour" className="h-9 w-full rounded-lg border border-line bg-raise" /></Field>
          {account.auth === 'password' && (
            <div className="sm:col-span-2"><Field label="New password" hint="Leave empty to keep the current one."><Input name="password" type="password" autoComplete="new-password" /></Field></div>
          )}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit" variant="primary">Save</Button>
            <Button variant="danger" className="ml-auto" onClick={remove}>Remove account</Button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
    </li>
  )
}

function AddAccount({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [method, setMethod] = useState<'google' | 'microsoft' | 'manual'>('manual')
  const [protocol, setProtocol] = useState<'imap' | 'pop3'>('imap')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function oauth() {
    setError('')
    try {
      const { url } = await api<{ url: string }>(`/oauth/${method}/start`)
      window.location.href = url
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const f = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>
    setBusy(true)
    setError('')
    try {
      await api('/accounts', {
        body: {
          email: f.email,
          name: f.name || f.email,
          protocol,
          username: f.username || f.email,
          password: f.password,
          inHost: f.inHost,
          inPort: Number(f.inPort),
          inTls: f.inSecurity === 'tls',
          smtpHost: f.smtpHost,
          smtpPort: Number(f.smtpPort),
          smtpTls: f.smtpSecurity === 'tls',
        },
      })
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const security = (name: string, defaultValue: string) => (
    <Field label="Security">
      <select name={name} defaultValue={defaultValue} className="w-full rounded-lg border border-line bg-raise px-3 py-2 text-ink"><option value="tls">SSL/TLS</option><option value="starttls">STARTTLS</option></select>
    </Field>
  )

  return (
    <Card title="Add an account" description="Use your provider’s sign-in where possible. It avoids storing your password.">
      <div className="grid gap-5">
        <div className="grid gap-2 sm:grid-cols-3">
          {([
            ['google', 'Google', 'OAuth2 sign-in'],
            ['microsoft', 'Microsoft', 'Outlook, Office 365'],
            ['manual', 'Other provider', 'IMAP / POP3 + SMTP'],
          ] as const).map(([id, name, detail]) => (
            <button key={id} type="button" aria-pressed={method === id} onClick={() => setMethod(id)} className={`rounded-xl border p-3 text-left ${method === id ? 'border-accent bg-sel' : 'border-line bg-raise hover:bg-hover'}`}>
              <p className="font-semibold">{name}</p>
              <p className="text-[12.5px] text-muted">{detail}</p>
            </button>
          ))}
        </div>

        {method !== 'manual' ? (
          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={oauth}>Continue with {method === 'google' ? 'Google' : 'Microsoft'}</Button>
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          </div>
        ) : (
          <form className="grid gap-4" onSubmit={submit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email address"><Input name="email" type="email" placeholder="you@example.com" required /></Field>
              <Field label="Display name"><Input name="name" placeholder="Personal" /></Field>
            </div>
            <fieldset className="grid gap-3 rounded-xl border border-line p-4">
              <legend className="px-1 text-[12.5px] font-semibold text-ink-2">Incoming mail</legend>
              <div className="flex gap-2" role="radiogroup" aria-label="Protocol">
                {(['imap', 'pop3'] as const).map((p) => (
                  <button key={p} type="button" role="radio" aria-checked={protocol === p} onClick={() => setProtocol(p)} className={`rounded-lg px-3 py-1.5 text-[13px] ${protocol === p ? 'bg-accent font-semibold text-accent-ink' : 'bg-raise text-ink-2'}`}>
                    {p.toUpperCase()}
                  </button>
                ))}
              </div>
              {protocol === 'pop3' && <p className="text-[12.5px] text-muted">POP3 downloads mail into Nexus. Folders, read state and stars stay in Nexus only and won’t sync to other apps.</p>}
              <div className="grid gap-3 sm:grid-cols-[1fr_100px_140px]">
                <Field label="Server"><Input name="inHost" placeholder={protocol === 'imap' ? 'imap.example.com' : 'pop.example.com'} required /></Field>
                <Field label="Port"><Input key={protocol} name="inPort" inputMode="numeric" defaultValue={protocol === 'imap' ? '993' : '995'} required /></Field>
                {security('inSecurity', 'tls')}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Username" hint="Usually your email address."><Input name="username" autoComplete="off" /></Field>
                <Field label="Password" hint="Stored encrypted. An app password is safer than your main one."><Input name="password" type="password" autoComplete="new-password" required /></Field>
              </div>
            </fieldset>
            <fieldset className="grid gap-3 rounded-xl border border-line p-4">
              <legend className="px-1 text-[12.5px] font-semibold text-ink-2">Outgoing mail (SMTP)</legend>
              <div className="grid gap-3 sm:grid-cols-[1fr_100px_140px]">
                <Field label="Server"><Input name="smtpHost" placeholder="smtp.example.com" required /></Field>
                <Field label="Port"><Input name="smtpPort" inputMode="numeric" defaultValue="465" required /></Field>
                {security('smtpSecurity', 'tls')}
              </div>
              {/* shortcut: SMTP reuses the incoming login, as almost every provider does; add separate fields if someone needs them. */}
              <p className="text-[12.5px] text-muted">Uses the same username and password as incoming mail.</p>
            </fieldset>
            {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Testing connection…' : 'Test and add account'}</Button>
              <Button variant="ghost" onClick={onCancel}>Cancel</Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  )
}
