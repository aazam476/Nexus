import { useQueryClient } from '@tanstack/react-query'
import { Inbox } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useOutletContext, useParams } from 'react-router'
import { MessageList, sections } from '../components/MessageList'
import { MessageView } from '../components/MessageView'
import type { ShellContext } from '../components/AppShell'
import { api, patch } from '../lib/api'
import { replySubject } from '../lib/format'
import { isTyping } from '../lib/keyboard'
import { useAccounts, useMessages, useRefreshMail } from '../lib/queries'
import { useStore } from '../lib/store'
import type { FolderRole, Message } from '../types'

const PAGE = 200

const folderTitles: Record<FolderRole, string> = {
  inbox: 'Inbox', starred: 'Starred', scheduled: 'Scheduled', drafts: 'Drafts',
  sent: 'Sent', archive: 'Archive', spam: 'Spam', trash: 'Trash',
}

export function MailPage() {
  const { folder = 'inbox', messageId } = useParams()
  const { search } = useLocation()
  const navigate = useNavigate()
  const { openNav } = useOutletContext<ShellContext>()
  const { layout, openComposer } = useStore()
  const client = useQueryClient()
  const refresh = useRefreshMail()
  const accounts = useAccounts().data ?? []
  const [query, setQuery] = useState('')
  const [searchText, setSearchText] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [error, setError] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // Wait until typing pauses before asking the server to search.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(searchText.trim()), 300)
    return () => clearTimeout(timer)
  }, [searchText])

  const params = new URLSearchParams(search)
  const accountId = params.get('account')
  const label = params.get('label')
  const role = folder as FolderRole
  // Start from one page again whenever the view changes.
  useEffect(() => setLimit(PAGE), [role, accountId, label, query])
  const list = useMessages({ folder: role, account: accountId, label, q: query || undefined, limit })
  const visible = list.data ?? []

  const selected = visible.find((m) => m.id === messageId)
  const title = query ? 'Search' : label ?? accounts.find((a) => a.id === accountId)?.email ?? folderTitles[role] ?? 'Mail'
  // Smart sections only make sense for the inbox; other folders stay chronological.
  const smart = role === 'inbox' && !query
  const canEdit = (message: Message) => accounts.find((a) => a.id === message.accountId)?.role !== 'viewer'

  // The order rows appear on screen, so j/k walk the list the way the user sees it.
  const ordered = smart ? sections.flatMap((s) => visible.filter((m) => m.category === s.category)) : visible

  // Change a message in every cached list right away; the server catches up in the background.
  function updateLocally(id: string, change: Partial<Message>) {
    client.setQueriesData<Message[]>({ queryKey: ['messages'] }, (rows) => rows?.map((m) => (m.id === id ? { ...m, ...change } : m)))
    client.setQueryData<Message>(['message', id], (m) => (m ? { ...m, ...change } : m))
  }

  async function run(action: () => Promise<unknown>) {
    setError('')
    try {
      await action()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      refresh()
    }
  }

  async function open(message: Message) {
    // Drafts written in Nexus open in the composer.
    if (message.outgoing && message.folder === 'drafts') {
      const draft = await api<Message>(`/messages/${message.id}`)
      openComposer({ id: draft.id, accountId: draft.accountId, to: draft.to.map((p) => p.email).join(', '), cc: draft.cc.map((p) => p.email).join(', '), subject: draft.subject, html: draft.html ?? '', forwardOf: draft.forwardOf })
      return
    }
    navigate(`/mail/${folder}/${message.id}${search}`)
    if (message.unread && !message.outgoing && canEdit(message)) {
      updateLocally(message.id, { unread: false })
      run(() => patch(`/messages/${message.id}`, { unread: false }))
    }
  }
  const close = () => navigate(`/mail/${folder}${search}`)
  const full = (message: Message) => client.getQueryData<Message>(['message', message.id]) ?? message

  // After moving the open message away, show the next one, like most mail apps do.
  function openNext() {
    if (!selected) return
    const next = ordered[ordered.indexOf(selected) + 1] ?? ordered[ordered.indexOf(selected) - 1]
    if (next) open(next)
    else close()
  }

  const actions = {
    move: (to: FolderRole) => {
      if (!selected) return
      openNext()
      run(() => api(`/messages/${selected.id}/move`, { body: { to } }))
    },
    remove: () => {
      if (!selected) return
      openNext()
      run(() => api(`/messages/${selected.id}`, { method: 'DELETE' }))
    },
    spam: (spam: boolean) => {
      if (!selected) return
      openNext()
      run(() => api(`/messages/${selected.id}/spam`, { body: { spam } }))
    },
    star: (message: Message) => {
      updateLocally(message.id, { starred: !message.starred })
      run(() => patch(`/messages/${message.id}`, { starred: !message.starred }))
    },
    markUnread: (message: Message) => {
      updateLocally(message.id, { unread: true })
      run(() => patch(`/messages/${message.id}`, { unread: true }))
      close()
    },
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (isTyping(event)) return
      const index = selected ? ordered.indexOf(selected) : -1
      const editable = selected && !selected.outgoing && canEdit(selected)
      switch (event.key) {
        case 'j': if (ordered[index + 1]) open(ordered[index + 1]); break
        case 'k': if (index > 0) open(ordered[index - 1]); break
        case '/': event.preventDefault(); searchRef.current?.focus(); break
        case 'e': if (editable) actions.move('archive'); break
        case '#': if (editable) actions.remove(); break
        case '!': if (editable) actions.spam(selected.folder !== 'spam'); break
        case 's': if (editable) actions.star(selected); break
        case 'u': if (editable) actions.markUnread(selected); break
        // The reader has the full message (Message-ID for threading, full text to quote); list rows don't.
        case 'r': if (selected) openComposer({ accountId: selected.accountId, to: selected.from.email, subject: replySubject(selected.subject), replyTo: full(selected) }); break
        case 'f': if (selected) openComposer({ accountId: selected.accountId, subject: replySubject(selected.subject, 'Fwd'), replyTo: full(selected), forwardOf: selected.id }); break
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

  const listPane = (
    <MessageList
      ref={searchRef}
      title={title}
      messages={visible}
      loading={list.isLoading}
      smart={smart}
      selectedId={messageId}
      query={searchText}
      onQuery={setSearchText}
      onOpen={open}
      onOpenNav={openNav}
      // A full page back means there may be more.
      onLoadMore={visible.length >= limit ? () => setLimit(limit + PAGE) : undefined}
      onArchiveAll={(items) => {
        // Shared accounts you can only view are left alone.
        const archivable = items.filter((m) => canEdit(m))
        archivable.forEach((m) => updateLocally(m.id, { folder: 'archive' }))
        // One at a time: each move opens an IMAP connection, and providers cap how many you may hold.
        run(async () => { for (const m of archivable) await api(`/messages/${m.id}/move`, { body: { to: 'archive' } }) })
      }}
    />
  )
  const reader = selected && (
    <MessageView key={selected.id} summary={selected} readOnly={!canEdit(selected)} onBack={close} actions={actions} onRefresh={refresh} />
  )

  // Phone, or the "list" layout: one pane at a time.
  // Desktop three-pane: list and reader side by side.
  return (
    <div className="relative flex h-full">
      <div className={`h-full border-r border-line ${selected ? 'hidden' : 'w-full'} ${layout === 'three-pane' ? 'md:block md:w-[400px] md:shrink-0' : ''}`}>
        {listPane}
      </div>
      <div className={`h-full min-w-0 flex-1 ${selected ? '' : 'hidden'} ${layout === 'three-pane' ? 'md:block' : ''}`}>
        {reader ?? <EmptyReader count={visible.filter((m) => m.unread).length} />}
      </div>
      {error && (
        <div role="alert" className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-line bg-panel px-4 py-2.5 shadow-pop">
          <span className="text-danger">{error}</span>
          <button type="button" className="text-muted hover:text-ink" onClick={() => setError('')}>Dismiss</button>
        </div>
      )}
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
