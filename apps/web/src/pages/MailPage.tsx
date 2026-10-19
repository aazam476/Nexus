import { Inbox } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useOutletContext, useParams } from 'react-router'
import { MessageList } from '../components/MessageList'
import { MessageView } from '../components/MessageView'
import type { ShellContext } from '../components/AppShell'
import { accounts } from '../mock/data'
import { isTyping } from '../lib/keyboard'
import { useStore } from '../lib/store'
import { replySubject } from '../lib/format'
import type { FolderRole, Message } from '../types'

const folderTitles: Record<FolderRole, string> = {
  inbox: 'Inbox', starred: 'Starred', scheduled: 'Scheduled', drafts: 'Drafts',
  sent: 'Sent', archive: 'Archive', spam: 'Spam', trash: 'Trash',
}

export function MailPage() {
  const { folder = 'inbox', messageId } = useParams()
  const { search } = useLocation()
  const navigate = useNavigate()
  const { openNav } = useOutletContext<ShellContext>()
  const { messages, updateMessage, layout, openComposer } = useStore()
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const params = new URLSearchParams(search)
  const accountId = params.get('account')
  const label = params.get('label')
  const role = folder as FolderRole

  const visible = messages
    .filter((m) => (role === 'starred' ? m.starred && m.folder !== 'trash' : m.folder === role))
    .filter((m) => !accountId || m.accountId === accountId)
    .filter((m) => !label || m.labels.includes(label))
    .filter((m) => !query || `${m.subject} ${m.from.name} ${m.from.email} ${m.preview}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date))

  const selected = visible.find((m) => m.id === messageId)
  const title = label ?? accounts.find((a) => a.id === accountId)?.email ?? folderTitles[role] ?? 'Mail'
  // Smart sections only make sense for the inbox; other folders stay chronological.
  const smart = role === 'inbox' && !query

  // The order rows appear on screen, so j/k walk the list the way the user sees it.
  const ordered = smart
    ? ['people', 'travel', 'notifications', 'newsletters'].flatMap((c) => visible.filter((m) => m.category === c))
    : visible

  const open = (message: Message) => {
    if (message.unread) updateMessage(message.id, { unread: false })
    navigate(`/mail/${folder}/${message.id}${search}`)
  }
  const close = () => navigate(`/mail/${folder}${search}`)

  const moveTo = (target: FolderRole) => {
    if (!selected) return
    const next = ordered[ordered.indexOf(selected) + 1] ?? ordered[ordered.indexOf(selected) - 1]
    updateMessage(selected.id, { folder: target })
    if (next) open(next)
    else close()
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (isTyping(event)) return
      const index = selected ? ordered.indexOf(selected) : -1
      switch (event.key) {
        case 'j': if (ordered[index + 1]) open(ordered[index + 1]); break
        case 'k': if (index > 0) open(ordered[index - 1]); break
        case '/': event.preventDefault(); searchRef.current?.focus(); break
        case 'e': moveTo('archive'); break
        case '#': moveTo('trash'); break
        case '!': moveTo('spam'); break
        case 's': if (selected) updateMessage(selected.id, { starred: !selected.starred }); break
        case 'u': if (selected) { updateMessage(selected.id, { unread: true }); close() } break
        case 'r': if (selected) openComposer({ to: selected.from.email, subject: replySubject(selected.subject), replyTo: selected }); break
        case 'f': if (selected) openComposer({ subject: replySubject(selected.subject, 'Fwd'), replyTo: selected }); break
        case 'Escape': if (selected) close(); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Keep the selected row visible while j/k moves through a long list.
  useEffect(() => {
    document.querySelector(`[data-message-id="${messageId}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [messageId])

  const list = (
    <MessageList
      ref={searchRef}
      title={title}
      messages={visible}
      smart={smart}
      selectedId={messageId}
      query={query}
      onQuery={setQuery}
      onOpen={open}
      onOpenNav={openNav}
    />
  )
  const reader = selected && (
    <MessageView key={selected.id} message={selected} onBack={close} onArchive={() => moveTo('archive')} onDelete={() => moveTo('trash')} onSpam={() => moveTo('spam')} />
  )

  // Phone, or the "list" layout: one pane at a time.
  // Desktop three-pane: list and reader side by side.
  return (
    <div className="flex h-full">
      <div className={`h-full border-r border-line ${selected ? 'hidden' : 'w-full'} ${layout === 'three-pane' ? 'md:block md:w-[400px] md:shrink-0' : ''}`}>
        {list}
      </div>
      <div className={`h-full min-w-0 flex-1 ${selected ? '' : 'hidden'} ${layout === 'three-pane' ? 'md:block' : ''}`}>
        {reader ?? <EmptyReader count={visible.filter((m) => m.unread).length} />}
      </div>
    </div>
  )
}

function EmptyReader({ count }: { count: number }) {
  return (
    <div className="grid h-full place-items-center bg-read text-center">
      <div className="grid justify-items-center gap-3">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-raise text-muted"><Inbox size={24} /></span>
        <p className="font-semibold">{count > 0 ? `${count} unread` : 'You are all caught up'}</p>
        <p className="text-muted">Pick a message, or press <b className="text-ink-2">j</b> to start at the top.</p>
      </div>
    </div>
  )
}
