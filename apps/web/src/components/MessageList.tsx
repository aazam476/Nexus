// The list of messages in a folder, grouped into smart sections (People, Travel, Notifications…) in the inbox.
import {
  Archive,
  ChevronDown,
  Clock,
  Columns2,
  Lock,
  Menu,
  Paperclip,
  PenLine,
  Rows3,
  Search,
  Star,
} from 'lucide-react'
import { forwardRef, useState } from 'react'
import { Link } from 'react-router'
import { useAccounts } from '../lib/queries'
import { formatListDate } from '../lib/format'
import { useStore } from '../lib/store'
import type { Category, Message } from '../types'
import { Avatar, Kbd } from './ui'

// The smart inbox groups mail by what it is. Machine mail collapses into bundles.
export const sections: { category: Category; title: string; color: string; bundled: boolean }[] = [
  { category: 'people', title: 'People', color: 'var(--people)', bundled: false },
  { category: 'travel', title: 'Travel', color: 'var(--travel)', bundled: false },
  { category: 'notifications', title: 'Notifications', color: 'var(--notif)', bundled: true },
  { category: 'newsletters', title: 'Newsletters', color: 'var(--news)', bundled: true },
]

interface Props {
  title: string
  messages: Message[]
  loading: boolean
  smart: boolean
  selectedId?: string
  query: string
  onQuery: (query: string) => void
  onOpen: (message: Message) => void
  onOpenNav: () => void
  onArchiveAll: (messages: Message[]) => void
  onLoadMore?: () => void
}

export const MessageList = forwardRef<HTMLInputElement, Props>(function MessageList(
  { title, messages, loading, smart, selectedId, query, onQuery, onOpen, onOpenNav, onArchiveAll, onLoadMore },
  searchRef,
) {
  const { layout, setLayout, openComposer } = useStore()
  const accounts = useAccounts().data
  const accountColor = (id: string) => accounts?.find((a) => a.id === id)?.color
  const [expanded, setExpanded] = useState<Category[]>([])
  const unread = messages.filter((m) => m.unread).length

  const row = (message: Message) => (
    <MessageRow
      key={message.id}
      message={message}
      accountColor={accountColor(message.accountId)}
      selected={message.id === selectedId}
      onOpen={() => onOpen(message)}
    />
  )

  return (
    <section aria-label={title} className="flex h-full flex-col overflow-hidden bg-panel">
      <header className="grid gap-2.5 px-3.5 pt-3.5 pb-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Open menu"
            onClick={onOpenNav}
            className="-ml-1 rounded-md p-1 text-muted hover:bg-raise md:hidden"
          >
            <Menu size={18} />
          </button>
          <h1 className="truncate text-[19px] font-bold tracking-tight">{title}</h1>
          <span className="ml-auto text-[12px] whitespace-nowrap text-muted">
            {unread > 0 ? `${unread} unread` : 'All read'}
          </span>
          <button
            type="button"
            title={layout === 'three-pane' ? 'Switch to list layout' : 'Switch to three-pane layout'}
            aria-label="Toggle layout"
            onClick={() => setLayout(layout === 'three-pane' ? 'list' : 'three-pane')}
            className="hidden rounded-md p-1 text-muted hover:bg-raise md:block"
          >
            {layout === 'three-pane' ? <Rows3 size={16} /> : <Columns2 size={16} />}
          </button>
          {/* Phones have no C key, and the sidebar's button is behind the menu. */}
          <button
            type="button"
            aria-label="New message"
            onClick={() => openComposer()}
            className="rounded-lg bg-accent p-1.5 text-accent-ink md:hidden"
          >
            <PenLine size={16} />
          </button>
        </div>
        <label className="flex items-center gap-2 rounded-[9px] border border-line bg-raise px-2.5 py-1.5 text-muted focus-within:border-accent">
          <Search size={15} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search all mail"
            aria-label="Search mail"
            className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-muted focus:outline-none"
          />
          <span className="hidden md:inline">
            <Kbd>/</Kbd>
          </span>
        </label>
      </header>

      <div className="flex-1 overflow-y-auto pb-6">
        {messages.length === 0 && !loading && (
          <div className="px-6 py-16 text-center">
            {accounts?.length === 0 ? (
              <>
                <p className="font-semibold">Connect your first mail account</p>
                <p className="mt-1 text-muted">Nexus works with any IMAP or POP3 provider, plus Gmail and Outlook.</p>
                <Link
                  to="/settings/accounts"
                  className="mt-4 inline-block rounded-lg bg-accent px-3 py-1.5 font-semibold text-accent-ink"
                >
                  Add account
                </Link>
              </>
            ) : (
              <>
                <p className="font-semibold">{query ? 'No messages match' : 'Nothing here'}</p>
                <p className="mt-1 text-muted">
                  {query ? `Nothing found for “${query}”.` : 'New mail will show up here.'}
                </p>
              </>
            )}
          </div>
        )}
        {loading && messages.length === 0 && (
          <p className="px-6 py-16 text-center text-muted" aria-busy="true">
            Loading mail…
          </p>
        )}

        {!smart && messages.map(row)}

        {smart &&
          sections.map(({ category, title, color, bundled }) => {
            const items = messages.filter((m) => m.category === category)
            if (items.length === 0) return null
            const isOpen = !bundled || expanded.includes(category)
            const toggle = () =>
              setExpanded((all) => (all.includes(category) ? all.filter((c) => c !== category) : [...all, category]))
            return (
              <div key={category}>
                <h2 className="flex items-center gap-2 px-4 pt-3 pb-1.5 text-[12px] font-semibold" style={{ color }}>
                  {title}
                  <span className="font-medium text-muted">{items.length}</span>
                  {bundled && (
                    <button
                      type="button"
                      onClick={() => onArchiveAll(items)}
                      className="ml-auto flex items-center gap-1 font-medium text-muted hover:text-ink"
                      title={`Archive all ${title.toLowerCase()}`}
                    >
                      <Archive size={13} /> Archive all
                    </button>
                  )}
                  {bundled && (
                    <button
                      type="button"
                      onClick={toggle}
                      className="flex items-center gap-1 font-medium text-muted hover:text-ink"
                    >
                      {isOpen ? 'Collapse' : 'Show all'}
                      <ChevronDown size={14} className={isOpen ? 'rotate-180' : ''} />
                    </button>
                  )}
                </h2>
                {isOpen ? items.map(row) : <Bundle items={items} onOpen={toggle} />}
              </div>
            )
          })}
        {onLoadMore && (
          <button
            type="button"
            onClick={onLoadMore}
            className="mx-auto mt-3 block rounded-lg px-3 py-1.5 text-[13px] text-muted hover:bg-raise hover:text-ink"
          >
            Load older mail
          </button>
        )}
      </div>
    </section>
  )
})

function MessageRow({
  message,
  accountColor,
  selected,
  onOpen,
}: {
  message: Message
  accountColor?: string
  selected: boolean
  onOpen: () => void
}) {
  const sender =
    message.folder === 'sent' || message.folder === 'scheduled'
      ? `To: ${message.to.map((p) => p.name).join(', ')}`
      : message.from.name
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={selected ? 'true' : undefined}
      data-message-id={message.id}
      className={`mx-1.5 grid w-[calc(100%-12px)] grid-cols-[34px_1fr_auto] gap-x-2.5 rounded-[10px] px-2.5 py-2 text-left ${
        selected ? 'bg-sel ring-1 ring-sel-line' : 'hover:bg-hover'
      }`}
    >
      <span className="row-span-3 pt-0.5">
        <Avatar name={message.from.name} accountColor={accountColor} />
      </span>
      <span className={`truncate ${message.unread ? 'font-bold text-ink' : 'font-medium text-ink-2'}`}>{sender}</span>
      <span
        className={`text-[12px] whitespace-nowrap ${message.unread ? 'font-semibold text-accent-text' : 'text-muted'}`}
      >
        {message.scheduledFor ? formatListDate(message.scheduledFor) : formatListDate(message.date)}
      </span>
      <span
        className={`col-span-2 flex min-w-0 items-center gap-1.5 ${message.unread ? 'font-bold text-ink' : 'text-ink-2'}`}
      >
        <span className="truncate">{message.subject}</span>
        {message.starred && <Star size={13} className="shrink-0 fill-notif text-notif" aria-label="Starred" />}
        {message.attachments.length > 0 && (
          <Paperclip size={13} className="shrink-0 text-muted" aria-label="Has attachments" />
        )}
        {message.security?.endsWith('encrypted') && (
          <Lock size={13} className="shrink-0 text-news" aria-label="Encrypted" />
        )}
        {message.scheduledFor && <Clock size={13} className="shrink-0 text-notif" aria-label="Scheduled" />}
        {message.error && <span className="shrink-0 text-[12px] font-semibold text-danger">Failed</span>}
      </span>
      <span className="col-span-2 truncate text-[12.5px] text-muted">{message.preview}</span>
    </button>
  )
}

function Bundle({ items, onOpen }: { items: Message[]; onOpen: () => void }) {
  const senders = [...new Set(items.map((m) => m.from.name))]
  const unread = items.filter((m) => m.unread).length
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mx-3 flex w-[calc(100%-24px)] items-center gap-3 rounded-xl bg-raise px-3 py-2.5 text-left hover:brightness-110"
    >
      <span className="flex shrink-0">
        {senders.slice(0, 3).map((name, i) => (
          <span key={name} className={`rounded-full ring-2 ring-raise ${i > 0 ? '-ml-2' : ''}`}>
            <Avatar name={name} size={26} />
          </span>
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${unread ? 'font-semibold' : 'text-ink-2'}`}>{senders.join(', ')}</span>
        <span className="block truncate text-[12px] text-muted">{items.map((m) => m.subject).join(' · ')}</span>
      </span>
      <span className="text-[12px] text-muted">{unread > 0 ? `${unread} new` : items.length}</span>
    </button>
  )
}
