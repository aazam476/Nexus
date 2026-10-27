// Settings → Admin, for admins only: the people on this server, its plugins, and how it's doing.
// Admins never see anyone's mail here, only counts and sync errors.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload, UserPlus } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Avatar, Button, Card, Chip, Field, Input, Toggle } from '../../components/ui'
import { api, del, patch, put } from '../../lib/api'
import { useMe } from '../../lib/queries'

interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'user'
  twoFactor: boolean // an authenticator app, a security key, or both
  privateStorage: boolean
}

interface Overview {
  users: number
  accounts: number
  feeds: number
  failing: { id: string; email: string; syncError: string; owner: { name: string } }[]
}

export function AdminSettings() {
  const me = useMe().data
  if (me?.role !== 'admin') return <p className="text-muted">Only admins can see this page.</p>
  return (
    <>
      <OverviewCard />
      <UsersCard myId={me.id} />
      <PluginsCard />
    </>
  )
}

function OverviewCard() {
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api<Overview>('/users/overview') }).data
  if (!overview) return null
  const counts = [
    ['Users', overview.users],
    ['Mail accounts', overview.accounts],
    ['Feeds', overview.feeds],
  ] as const
  return (
    <Card title="Server">
      <div className="grid gap-4">
        <dl className="grid grid-cols-3 gap-3">
          {counts.map(([label, count]) => (
            <div key={label} className="rounded-xl bg-raise px-4 py-3">
              <dt className="text-[12.5px] text-muted">{label}</dt>
              <dd className="text-[22px] font-bold tabular-nums">{count}</dd>
            </div>
          ))}
        </dl>
        {overview.failing.length === 0 ? (
          <p className="text-[13px] text-muted">Every mail account is syncing.</p>
        ) : (
          <div className="grid gap-2">
            <p className="font-semibold">Accounts that fail to sync</p>
            <ul className="grid gap-1.5 text-[13px]">
              {overview.failing.map((a) => (
                <li key={a.id}>
                  <span className="font-medium">{a.email}</span> <span className="text-muted">({a.owner.name})</span>
                  <span className="block text-danger">{a.syncError}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  )
}

function UsersCard({ myId }: { myId: string }) {
  const client = useQueryClient()
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') }).data ?? []
  const [inviting, setInviting] = useState(false)
  const [resetting, setResetting] = useState<string | null>(null)
  const [error, setError] = useState('')
  const refresh = () => client.invalidateQueries({ queryKey: ['users'] })

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = Object.fromEntries(new FormData(event.currentTarget))
    try {
      await api('/users', { body: form })
      setInviting(false)
      setError('')
      refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function remove(user: User) {
    if (!confirm(`Delete ${user.name}'s Nexus account? Their mail accounts are removed from Nexus too.`)) return
    await del(`/users/${user.id}`).catch((e) => setError(e.message))
    refresh()
  }

  // For someone who lost both their phone and their recovery codes; they can set it up again.
  async function turnOffTwoFactor(user: User) {
    if (!confirm(`Turn off two-factor sign-in for ${user.name}? Only do this once you're sure it's really them.`))
      return
    await del(`/users/${user.id}/2fa`).catch((e) => setError(e.message))
    refresh()
  }

  return (
    <Card
      title="Users on this server"
      description="Each person signs in with their own password and 2FA."
      actions={
        !inviting && (
          <Button variant="primary" onClick={() => setInviting(true)}>
            <UserPlus size={15} /> Add user
          </Button>
        )
      }
    >
      <div className="grid gap-4">
        {inviting && (
          <form onSubmit={invite} className="grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-2">
            <Field label="Name">
              <Input name="name" required autoFocus />
            </Field>
            <Field label="Email">
              <Input name="email" type="email" required />
            </Field>
            <Field label="Starting password" hint="Share it with them privately; they can change it.">
              <Input name="password" type="text" minLength={12} required autoComplete="off" />
            </Field>
            <Field label="Role">
              <select
                name="role"
                defaultValue="user"
                className="w-full rounded-lg border border-line bg-raise px-3 py-2 text-ink"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" variant="primary">
                Add user
              </Button>
              <Button onClick={() => setInviting(false)}>Cancel</Button>
            </div>
          </form>
        )}
        <ul className="divide-y divide-line">
          {users.map((user) => (
            <li key={user.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
              <Avatar name={user.name} size={32} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {user.name}
                  {user.id === myId && <span className="text-muted"> (you)</span>}
                </p>
                <p className="text-[12.5px] text-muted">{user.email}</p>
              </div>
              {!user.twoFactor && <Chip color="var(--notif)">2FA off</Chip>}
              <select
                value={user.role}
                disabled={user.id === myId}
                aria-label={`Role for ${user.name}`}
                onChange={(e) =>
                  patch(`/users/${user.id}`, { role: e.target.value }).then(refresh, (err) => setError(err.message))
                }
                className="rounded-lg border border-line bg-raise px-2.5 py-1.5 text-ink disabled:opacity-60"
              >
                <option value="admin">Admin</option>
                <option value="user">User</option>
              </select>
              {user.id !== myId && (
                <Button variant="ghost" onClick={() => setResetting(resetting === user.id ? null : user.id)}>
                  Reset password
                </Button>
              )}
              {user.twoFactor && user.id !== myId && (
                <Button variant="ghost" onClick={() => turnOffTwoFactor(user)}>
                  Turn off 2FA
                </Button>
              )}
              {user.id !== myId && (
                <Button variant="ghost" onClick={() => remove(user)}>
                  Delete
                </Button>
              )}
              {resetting === user.id && <ResetPassword user={user} onDone={() => setResetting(null)} />}
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
      </div>
    </Card>
  )
}

// A new starting password for someone who forgot theirs. It signs them out everywhere.
function ResetPassword({ user, onDone }: { user: User; onDone: () => void }) {
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const result = await api<{ redownloading: number }>(`/users/${user.id}/password`, {
        body: Object.fromEntries(new FormData(event.currentTarget)),
      })
      setDone(
        result.redownloading
          ? 'Password reset. Their private storage is off now and their mail is downloading again.'
          : 'Password reset. Share the new password with them privately.',
      )
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (done)
    return (
      <div className="flex w-full flex-wrap items-center gap-3">
        <p role="status" className="text-[13px] text-news">
          {done}
        </p>
        <Button variant="ghost" onClick={onDone}>
          Close
        </Button>
      </div>
    )
  return (
    <form onSubmit={submit} className="grid w-full gap-2 rounded-xl border border-line p-3">
      {user.privateStorage && (
        <p className="text-[13px] text-ink-2">
          {user.name} uses private storage, which is locked with their old password. Resetting turns it off and
          downloads their mail again from the mail server; anything only in Nexus, like labels, is lost.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field label={`New password for ${user.name}`} hint="At least 12 characters. Share it with them privately.">
            <Input name="password" type="text" minLength={12} required autoComplete="off" autoFocus />
          </Field>
        </div>
        <Button type="submit" variant="primary">
          Reset password
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </form>
  )
}

interface ServerPlugin {
  id: string
  name: string
  description: string
  author: string
  builtIn: boolean
  enabled: boolean // for everyone on the server
  removed: boolean // a deleted built-in plugin, which can be restored
  users: number // how many people have it turned on
}

interface Review {
  sha256: string
  size: number
  findings: string[]
}

// Turning plugins on or off for everyone, and adding or deleting them. Each person still turns a
// plugin on for themself and fills in its settings in Settings → Plugins.
function PluginsCard() {
  const client = useQueryClient()
  const plugins = useQuery({ queryKey: ['admin-plugins'], queryFn: () => api<ServerPlugin[]>('/admin/plugins') }).data
  const [adding, setAdding] = useState<{ code: string; filename: string; review: Review } | null>(null)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const refresh = () => {
    client.invalidateQueries({ queryKey: ['admin-plugins'] })
    client.invalidateQueries({ queryKey: ['plugins'] })
  }

  async function pick(file: File) {
    setError('')
    try {
      const code = await file.text()
      setAdding({ code, filename: file.name, review: await api<Review>('/admin/plugins/review', { body: { code } }) })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function install() {
    try {
      await api('/admin/plugins', { body: { code: adding!.code, sha256: adding!.review.sha256 } })
      setAdding(null)
      refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function setEnabled(plugin: ServerPlugin, enabled: boolean) {
    await put(`/admin/plugins/${plugin.id}`, { enabled }).catch((e) => setError(e.message))
    refresh()
  }

  async function remove(plugin: ServerPlugin) {
    const restorable = plugin.builtIn ? ' It ships with Nexus, so you can restore it later.' : ''
    if (!confirm(`Delete ${plugin.name}? Everyone’s settings for it are deleted too.${restorable}`)) return
    await del(`/admin/plugins/${plugin.id}`).catch((e) => setError(e.message))
    refresh()
  }

  return (
    <Card
      title="Plugins"
      description="Turn a plugin off to hide it from everyone. Each person turns it on for themself in Settings → Plugins."
      actions={
        !adding && (
          <Button onClick={() => fileInput.current?.click()}>
            <Upload size={15} /> Add plugin
          </Button>
        )
      }
    >
      <div className="grid gap-4">
        {/* The real file picker, hidden; the button above opens it. */}
        <input
          ref={fileInput}
          type="file"
          accept=".js,.mjs,text/javascript"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) pick(file)
            event.target.value = '' // so picking the same file again still counts as a change
          }}
        />
        {adding && <PluginReview {...adding} onInstall={install} onCancel={() => setAdding(null)} />}
        <ul className="divide-y divide-line">
          {plugins
            ?.filter((plugin) => !plugin.removed)
            .map((plugin) => (
              <li key={plugin.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {plugin.name} {plugin.builtIn && <Chip color="var(--muted)">Built in</Chip>}
                  </p>
                  <p className="text-[12.5px] text-muted">{plugin.description}</p>
                  <p className="text-[12.5px] text-muted">
                    Created by {plugin.author} · Turned on by {plugin.users} {plugin.users === 1 ? 'user' : 'users'}
                  </p>
                </div>
                <Button variant="ghost" onClick={() => remove(plugin)}>
                  Delete
                </Button>
                <Toggle
                  checked={plugin.enabled}
                  onChange={(on) => setEnabled(plugin, on)}
                  label={`${plugin.name} for everyone`}
                />
              </li>
            ))}
        </ul>
        {/* Deleted built-in plugins: their code ships with Nexus, so they can come back. */}
        {plugins?.some((plugin) => plugin.removed) && (
          <div className="grid gap-2 border-t border-line pt-3">
            <p className="text-[12.5px] font-semibold text-ink-2">Deleted built-in plugins</p>
            {plugins
              .filter((plugin) => plugin.removed)
              .map((plugin) => (
                <div key={plugin.id} className="flex items-center gap-3">
                  <span className="flex-1 text-muted">{plugin.name}</span>
                  <Button onClick={() => setEnabled(plugin, true)}>Restore</Button>
                </div>
              ))}
          </div>
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

// What the admin sees before installing: the warning, what the quick look found, the fingerprint,
// and the code itself.
function PluginReview({
  code,
  filename,
  review,
  onInstall,
  onCancel,
}: {
  code: string
  filename: string
  review: Review
  onInstall: () => void
  onCancel: () => void
}) {
  return (
    <div className="grid gap-3 rounded-xl border border-line p-4">
      <p className="font-semibold">Install {filename}?</p>
      <p className="text-[13px] text-ink-2">
        A plugin runs inside Nexus with full access to everyone’s mail and the server’s secrets. Nexus can’t prove a
        plugin is safe. Only install code from someone you trust, and read it first.
      </p>
      {review.findings.length > 0 ? (
        <div className="grid gap-1">
          <p className="text-[13px] font-semibold text-danger">Read these parts closely. The code:</p>
          <ul className="grid list-disc gap-0.5 pl-5 text-[13px] text-danger">
            {review.findings.map((finding) => (
              <li key={finding}>{finding}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-[13px] text-muted">
          A quick look found nothing unusual. That isn’t a guarantee; it can miss well-hidden code.
        </p>
      )}
      <p className="text-[12.5px] text-muted">
        Fingerprint (SHA-256), to compare with the one the author publishes:{' '}
        <code className="font-mono break-all">{review.sha256}</code>
      </p>
      <details>
        <summary className="cursor-pointer text-[13px]">Show the code ({Math.ceil(review.size / 1024)} KB)</summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-raise p-3 font-mono text-[12px] whitespace-pre-wrap">
          {code}
        </pre>
      </details>
      <div className="flex gap-2">
        <Button variant="danger" onClick={onInstall}>
          Install plugin
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
