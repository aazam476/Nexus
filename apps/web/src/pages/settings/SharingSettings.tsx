import { useQuery, useQueryClient } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Avatar, Button, Card, Chip, Field, Input } from '../../components/ui'
import { api, del, patch, put } from '../../lib/api'
import { useAccounts, useMe } from '../../lib/queries'
import type { Account } from '../../types'

interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'user'
  totpEnabled: boolean
}

const roleHelp = {
  editor: 'Read, send, move and delete mail',
  viewer: 'Read only',
}

export function SharingSettings() {
  const me = useMe().data
  const owned = (useAccounts().data ?? []).filter((a) => a.role === 'owner')
  return (
    <>
      {me?.role === 'admin' && <UsersCard myId={me.id} />}
      <Card title="Shared mailboxes" description="Give other people on this server access to one of your accounts, like a family or team inbox.">
        {owned.length === 0 ? (
          <p className="text-muted">Add a mail account first; then you can share it here.</p>
        ) : (
          <div className="grid gap-4">
            {owned.map((account) => <AccountMembers key={account.id} account={account} />)}
            <dl className="grid gap-1 text-[12.5px] text-muted">
              {Object.entries(roleHelp).map(([role, help]) => <div key={role}><dt className="inline font-semibold text-ink-2">{role}: </dt><dd className="inline">{help}</dd></div>)}
            </dl>
          </div>
        )}
      </Card>
    </>
  )
}

function UsersCard({ myId }: { myId: string }) {
  const client = useQueryClient()
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') }).data ?? []
  const [inviting, setInviting] = useState(false)
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

  return (
    <Card title="Users on this server" description="Each person signs in with their own password and 2FA." actions={!inviting && <Button variant="primary" onClick={() => setInviting(true)}><UserPlus size={15} /> Add user</Button>}>
      <div className="grid gap-4">
        {inviting && (
          <form onSubmit={invite} className="grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-2">
            <Field label="Name"><Input name="name" required autoFocus /></Field>
            <Field label="Email"><Input name="email" type="email" required /></Field>
            <Field label="Starting password" hint="Share it with them privately; they can change it."><Input name="password" type="text" minLength={12} required autoComplete="off" /></Field>
            <Field label="Role">
              <select name="role" defaultValue="user" className="w-full rounded-lg border border-line bg-raise px-3 py-2 text-ink"><option value="user">User</option><option value="admin">Admin</option></select>
            </Field>
            <div className="flex gap-2 sm:col-span-2"><Button type="submit" variant="primary">Add user</Button><Button onClick={() => setInviting(false)}>Cancel</Button></div>
          </form>
        )}
        <ul className="divide-y divide-line">
          {users.map((user) => (
            <li key={user.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
              <Avatar name={user.name} size={32} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{user.name}{user.id === myId && <span className="text-muted"> (you)</span>}</p>
                <p className="text-[12.5px] text-muted">{user.email}</p>
              </div>
              {!user.totpEnabled && <Chip color="var(--notif)">2FA off</Chip>}
              <select
                value={user.role}
                disabled={user.id === myId}
                aria-label={`Role for ${user.name}`}
                onChange={(e) => patch(`/users/${user.id}`, { role: e.target.value }).then(refresh, (err) => setError(err.message))}
                className="rounded-lg border border-line bg-raise px-2.5 py-1.5 text-ink disabled:opacity-60"
              >
                <option value="admin">Admin</option><option value="user">User</option>
              </select>
              {user.id !== myId && <Button variant="ghost" onClick={() => remove(user)}>Delete</Button>}
            </li>
          ))}
        </ul>
        {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      </div>
    </Card>
  )
}

function AccountMembers({ account }: { account: Account }) {
  const client = useQueryClient()
  const key = ['members', account.id]
  const members = useQuery({ queryKey: key, queryFn: () => api<{ userId: string; name: string; email: string; role: 'editor' | 'viewer' }[]>(`/accounts/${account.id}/members`) }).data ?? []
  const directory = useQuery({ queryKey: ['directory'], queryFn: () => api<{ id: string; name: string; email: string }[]>('/users/directory') }).data ?? []
  const me = useMe().data
  const [error, setError] = useState('')
  const refresh = () => client.invalidateQueries({ queryKey: key })
  const candidates = directory.filter((u) => u.id !== me?.id && !members.some((m) => m.userId === u.id))

  const setRole = (userId: string, role: string) => put(`/accounts/${account.id}/members`, { userId, role }).then(refresh, (e) => setError(e.message))

  return (
    <div className="rounded-xl border border-line">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <i className="h-2.5 w-2.5 rounded-full" style={{ background: account.color }} />
        <span className="font-medium">{account.email}</span>
        <span className="ml-auto text-[12.5px] text-muted">{members.length ? `${members.length} ${members.length === 1 ? 'person' : 'people'}` : 'Only you'}</span>
      </div>
      {members.map((m) => (
        <div key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
          <Avatar name={m.name} size={26} />
          <span className="flex-1">{m.name} <span className="text-muted">{m.email}</span></span>
          <select value={m.role} aria-label={`Access for ${m.name}`} onChange={(e) => setRole(m.userId, e.target.value)} className="rounded-lg border border-line bg-raise px-2.5 py-1.5 text-ink">
            <option value="editor">Editor</option><option value="viewer">Viewer</option>
          </select>
          <Button variant="ghost" onClick={() => del(`/accounts/${account.id}/members/${m.userId}`).then(refresh)}>Remove</Button>
        </div>
      ))}
      {candidates.length > 0 && (
        <form className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); setRole(String(f.get('userId')), String(f.get('role'))) }}>
          <select name="userId" aria-label="Person to share with" className="min-w-0 flex-1 rounded-lg border border-line bg-raise px-2.5 py-1.5 text-ink">
            {candidates.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
          </select>
          <select name="role" defaultValue="viewer" aria-label="Access level" className="rounded-lg border border-line bg-raise px-2.5 py-1.5 text-ink">
            <option value="viewer">Viewer</option><option value="editor">Editor</option>
          </select>
          <Button type="submit">Share</Button>
        </form>
      )}
      {error && <p role="alert" className="px-4 pb-2.5 text-[13px] text-danger">{error}</p>}
    </div>
  )
}
