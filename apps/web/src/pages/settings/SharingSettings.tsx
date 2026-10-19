import { Plus, UserPlus } from 'lucide-react'
import { Avatar, Button, Card, Chip } from '../../components/ui'
import { accounts } from '../../mock/data'

const users = [
  { name: 'Ali Azam', email: 'ali@azam.email', role: 'Admin', twoFactor: true },
  { name: 'Sana Azam', email: 'sana@azam.email', role: 'User', twoFactor: true },
  { name: 'Tom Brandt', email: 'tom@brandt.house', role: 'User', twoFactor: false },
]

const access = [
  { account: 'home@fastmail.com', user: 'Sana Azam', role: 'editor' },
  { account: 'home@fastmail.com', user: 'Tom Brandt', role: 'viewer' },
]

const roleHelp = {
  owner: 'Full control, can share and delete',
  editor: 'Read, send, move and delete mail',
  viewer: 'Read only',
}

export function SharingSettings() {
  return (
    <>
      <Card title="Users on this server" description="Admins can invite people. Each user signs in with their own password and 2FA." actions={<Button variant="primary"><UserPlus size={15} /> Invite user</Button>}>
        <ul className="divide-y divide-line">
          {users.map((user) => (
            <li key={user.email} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
              <Avatar name={user.name} size={32} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{user.name}</p>
                <p className="text-[12.5px] text-muted">{user.email}</p>
              </div>
              {!user.twoFactor && <Chip color="var(--notif)">2FA off</Chip>}
              <select defaultValue={user.role} aria-label={`Role for ${user.name}`} className="rounded-lg border border-line bg-raise px-2.5 py-1.5 text-ink">
                <option>Admin</option><option>User</option>
              </select>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Shared mailboxes" description="Give other users access to one of your accounts, like a family or team inbox." actions={<Button variant="secondary"><Plus size={15} /> Share an account</Button>}>
        <div className="grid gap-4">
          {accounts.filter((a) => a.role === 'owner').map((account) => {
            const members = access.filter((a) => a.account === account.email)
            return (
              <div key={account.id} className="rounded-xl border border-line">
                <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                  <i className="h-2.5 w-2.5 rounded-full" style={{ background: account.color }} />
                  <span className="font-medium">{account.email}</span>
                  <span className="ml-auto text-[12.5px] text-muted">{members.length ? `${members.length} people` : 'Only you'}</span>
                </div>
                {members.map((m) => (
                  <div key={m.user} className="flex items-center gap-3 px-4 py-2.5">
                    <Avatar name={m.user} size={26} />
                    <span className="flex-1">{m.user}</span>
                    <select defaultValue={m.role} aria-label={`Access for ${m.user}`} className="rounded-lg border border-line bg-raise px-2.5 py-1.5 text-ink">
                      {Object.entries(roleHelp).map(([role, help]) => <option key={role} value={role} title={help}>{role[0].toUpperCase() + role.slice(1)}</option>)}
                    </select>
                    <Button variant="ghost">Remove</Button>
                  </div>
                ))}
              </div>
            )
          })}
          <dl className="grid gap-1 text-[12.5px] text-muted">
            {Object.entries(roleHelp).map(([role, help]) => <div key={role}><dt className="inline font-semibold text-ink-2">{role}: </dt><dd className="inline">{help}</dd></div>)}
          </dl>
        </div>
      </Card>
    </>
  )
}
