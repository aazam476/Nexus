// Settings → Sharing: owners share their mail accounts with other people on the server, as editor or viewer.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Avatar, Button, Card, Select } from '../../components/ui'
import { api, del, put } from '../../lib/api'
import { useAccounts, useMe } from '../../lib/queries'
import type { Account } from '../../types'

const roleHelp = {
  editor: 'Read, send, move and delete mail',
  viewer: 'Read only',
}

export function SharingSettings() {
  const owned = (useAccounts().data ?? []).filter((a) => a.role === 'owner')
  return (
    <Card
      title="Shared mailboxes"
      description="Give other people on this server access to one of your accounts, like a family or team inbox."
    >
      {owned.length === 0 ? (
        <p className="text-muted">Add a mail account first; then you can share it here.</p>
      ) : (
        <div className="grid gap-4">
          {owned.map((account) => (
            <AccountMembers key={account.id} account={account} />
          ))}
          <dl className="grid gap-1 text-[12.5px] text-muted">
            {Object.entries(roleHelp).map(([role, help]) => (
              <div key={role}>
                <dt className="inline font-semibold text-ink-2">{role}: </dt>
                <dd className="inline">{help}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Card>
  )
}

function AccountMembers({ account }: { account: Account }) {
  const client = useQueryClient()
  const key = ['members', account.id]
  const members =
    useQuery({
      queryKey: key,
      queryFn: () =>
        api<{ userId: string; name: string; email: string; role: 'editor' | 'viewer' }[]>(
          `/accounts/${account.id}/members`,
        ),
    }).data ?? []
  const directory =
    useQuery({
      queryKey: ['directory'],
      queryFn: () => api<{ id: string; name: string; email: string }[]>('/users/directory'),
    }).data ?? []
  const me = useMe().data
  const [error, setError] = useState('')
  const refresh = () => client.invalidateQueries({ queryKey: key })
  const candidates = directory.filter((u) => u.id !== me?.id && !members.some((m) => m.userId === u.id))

  const setRole = (userId: string, role: string) =>
    put(`/accounts/${account.id}/members`, { userId, role }).then(refresh, (e) => setError(e.message))

  return (
    <div className="rounded-xl border border-line">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <i className="h-2.5 w-2.5 rounded-full" style={{ background: account.color }} />
        <span className="font-medium">{account.email}</span>
        <span className="ml-auto text-[12.5px] text-muted">
          {members.length ? `${members.length} ${members.length === 1 ? 'person' : 'people'}` : 'Only you'}
        </span>
      </div>
      {members.map((m) => (
        <div key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
          <Avatar name={m.name} size={26} />
          <span className="flex-1">
            {m.name} <span className="text-muted">{m.email}</span>
          </span>
          <Select
            value={m.role}
            aria-label={`Access for ${m.name}`}
            onChange={(e) => setRole(m.userId, e.target.value)}
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </Select>
          <Button variant="ghost" onClick={() => del(`/accounts/${account.id}/members/${m.userId}`).then(refresh)}>
            Remove
          </Button>
        </div>
      ))}
      {candidates.length > 0 && (
        <form
          className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5"
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            setRole(String(f.get('userId')), String(f.get('role')))
          }}
        >
          <Select name="userId" aria-label="Person to share with" className="min-w-0 flex-1">
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </Select>
          <Select name="role" defaultValue="viewer" aria-label="Access level">
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
          </Select>
          <Button type="submit">Share</Button>
        </form>
      )}
      {error && (
        <p role="alert" className="px-4 pb-2.5 text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
