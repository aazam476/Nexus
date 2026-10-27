// Settings → Admin, for admins only: the people on this server and how the server is doing.
// Admins never see anyone's mail here, only counts and sync errors.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Avatar, Button, Card, Chip, Field, Input } from '../../components/ui'
import { api, del, patch } from '../../lib/api'
import { useMe } from '../../lib/queries'

interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'user'
  totpEnabled: boolean
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
              {!user.totpEnabled && <Chip color="var(--notif)">2FA off</Chip>}
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
              {user.totpEnabled && user.id !== myId && (
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
