import { Archive, BookUser, Clock, FileText, Inbox, PenLine, Send, Settings, ShieldAlert, Star, Trash2, type LucideIcon } from 'lucide-react'
import { NavLink, useLocation } from 'react-router'
import { accounts, labels } from '../mock/data'
import { useStore } from '../lib/store'
import type { FolderRole } from '../types'
import { Kbd, Logo } from './ui'

const folders: { role: FolderRole; name: string; icon: LucideIcon }[] = [
  { role: 'inbox', name: 'Inbox', icon: Inbox },
  { role: 'starred', name: 'Starred', icon: Star },
  { role: 'scheduled', name: 'Scheduled', icon: Clock },
  { role: 'drafts', name: 'Drafts', icon: FileText },
  { role: 'sent', name: 'Sent', icon: Send },
  { role: 'archive', name: 'Archive', icon: Archive },
  { role: 'spam', name: 'Spam', icon: ShieldAlert },
  { role: 'trash', name: 'Trash', icon: Trash2 },
]

const itemClass = (active: boolean) =>
  `flex items-center gap-2.5 rounded-lg px-2 py-1.5 ${active ? 'bg-raise font-semibold text-ink' : 'text-ink-2 hover:bg-hover'}`

function Count({ value }: { value: number }) {
  return value > 0 ? <span className="ml-auto text-[12px] text-muted">{value}</span> : null
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { messages, openComposer } = useStore()
  const { pathname, search } = useLocation()
  const accountFilter = new URLSearchParams(search).get('account')

  const unreadIn = (role: FolderRole) =>
    messages.filter((m) => (role === 'starred' ? m.starred : m.folder === role) && (role === 'scheduled' || m.unread)).length

  return (
    <nav aria-label="Mailboxes" className="flex h-full flex-col gap-4 overflow-y-auto bg-gradient-to-b from-side to-ground px-2.5 py-3.5">
      <div className="flex items-center gap-2.5 px-1.5">
        <Logo size={26} />
        <span className="text-[16px] font-bold tracking-tight">Nexus</span>
      </div>

      <button
        type="button"
        onClick={() => { openComposer(); onNavigate?.() }}
        className="accent-gradient flex items-center gap-2 rounded-xl px-3 py-2.5 font-semibold text-accent-ink shadow-[0_4px_12px_-4px_rgb(0_0_0/0.5)] hover:brightness-105"
      >
        <PenLine size={16} strokeWidth={2} />
        New message
        <span className="ml-auto rounded bg-black/15 px-1.5 text-[11px]">C</span>
      </button>

      <div className="grid gap-0.5">
        {folders.map(({ role, name, icon: Icon }) => (
          <NavLink key={role} to={`/mail/${role}`} onClick={onNavigate} className={() => itemClass(pathname.startsWith(`/mail/${role}`) && !accountFilter)}>
            <Icon size={16} strokeWidth={1.8} />
            {name}
            <Count value={unreadIn(role)} />
          </NavLink>
        ))}
      </div>

      <div className="grid gap-0.5">
        <h2 className="px-2 pb-1 text-[12px] font-semibold text-faint">Accounts</h2>
        {accounts.map((account) => (
          <NavLink
            key={account.id}
            to={`/mail/inbox?account=${account.id}`}
            onClick={onNavigate}
            className={() => itemClass(accountFilter === account.id)}
            title={account.email}
          >
            <i className="mx-1 h-2 w-2 shrink-0 rounded-full" style={{ background: account.color }} />
            <span className="truncate">{account.email}</span>
            <Count value={messages.filter((m) => m.accountId === account.id && m.folder === 'inbox' && m.unread).length} />
          </NavLink>
        ))}
      </div>

      <div className="grid gap-0.5">
        <h2 className="px-2 pb-1 text-[12px] font-semibold text-faint">Labels</h2>
        {labels.map((label) => (
          <NavLink key={label.name} to={`/mail/inbox?label=${label.name}`} onClick={onNavigate} className={() => itemClass(search.includes(`label=${label.name}`))}>
            <i className="mx-1 h-2 w-2 shrink-0 rounded-sm" style={{ background: label.color }} />
            {label.name}
            <Count value={messages.filter((m) => m.labels.includes(label.name) && m.unread).length} />
          </NavLink>
        ))}
      </div>

      <div className="mt-auto grid gap-0.5 border-t border-line pt-3">
        <NavLink to="/contacts" onClick={onNavigate} className={({ isActive }) => itemClass(isActive)}>
          <BookUser size={16} strokeWidth={1.8} /> Contacts
        </NavLink>
        <NavLink to="/settings" onClick={onNavigate} className={({ isActive }) => itemClass(isActive)}>
          <Settings size={16} strokeWidth={1.8} /> Settings
        </NavLink>
        <div className="flex items-center gap-2 px-2 pt-2 text-[12px] text-muted">
          <i className="h-[7px] w-[7px] rounded-full bg-news" />
          Synced just now
          <span className="ml-auto"><Kbd>?</Kbd></span>
        </div>
      </div>
    </nav>
  )
}
