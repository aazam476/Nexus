import {
  Archive, ArrowLeft, CalendarPlus, Check, Download, Eye, FileText, Forward, Image, Inbox, KeyRound, Lock, MailOpen, Reply, ReplyAll, ShieldAlert, ShieldCheck, ShieldX, Star, Trash2, X,
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { formatFullDate, formatSize, replySubject } from '../lib/format'
import * as pgp from '../lib/pgp'
import { useAccounts, useMessage, usePlugins } from '../lib/queries'
import { useStore } from '../lib/store'
import type { Attachment, CalendarEvent, FolderRole, Message } from '../types'
import { sections } from './MessageList'
import { SafeHtml } from './SafeHtml'
import { SaveToMenu } from './SaveToMenu'
import { Avatar, Button, Chip, Input } from './ui'

interface Props {
  summary: Message // the list row, shown while the full message loads
  readOnly: boolean // viewers of a shared account can't change anything
  onBack: () => void
  onRefresh: () => void
  actions: {
    move: (to: FolderRole) => void
    remove: () => void
    spam: (spam: boolean) => void
    star: (message: Message) => void
    markUnread: (message: Message) => void
  }
}

const attachmentUrl = (messageId: string, file: Attachment, download = false) => `/api/messages/${messageId}/attachments/${file.id}${download ? '?download' : ''}`

export function MessageView({ summary, readOnly, onBack, onRefresh, actions }: Props) {
  const { openComposer } = useStore()
  const detail = useMessage(summary.id)
  const message: Message = { ...summary, ...detail.data, starred: summary.starred, unread: summary.unread }
  const [preview, setPreview] = useState<Attachment | null>(null)
  const account = useAccounts().data?.find((a) => a.id === message.accountId)
  const section = sections.find((s) => s.category === message.category)

  const reply = (all = false) =>
    openComposer({
      accountId: message.accountId,
      to: message.from.email,
      cc: all ? [...message.to, ...message.cc].map((p) => p.email).filter((e) => e !== account?.email).join(', ') : '',
      subject: replySubject(message.subject),
      replyTo: message,
    })
  const forward = () => openComposer({ accountId: message.accountId, subject: replySubject(message.subject, 'Fwd'), replyTo: message })
  const inSpam = message.folder === 'spam'

  return (
    <article className="flex h-full flex-col overflow-hidden bg-read" aria-label={message.subject}>
      <div className="flex items-center gap-0.5 border-b border-line px-2 py-2 md:px-4">
        <ToolButton label="Back" icon={ArrowLeft} onClick={onBack} className="md:hidden" />
        {!message.outgoing && (
          <>
            <ToolButton label="Reply" icon={Reply} onClick={() => reply()} showLabel />
            <ToolButton label="Reply all" icon={ReplyAll} onClick={() => reply(true)} />
            <ToolButton label="Forward" icon={Forward} onClick={forward} showLabel />
          </>
        )}
        {!readOnly && !message.outgoing && (
          <>
            <span className="mx-1 h-5 w-px bg-line" />
            {message.folder === 'inbox' ? (
              <ToolButton label="Archive" icon={Archive} onClick={() => actions.move('archive')} />
            ) : (
              <ToolButton label="Move to Inbox" icon={Inbox} onClick={() => actions.move('inbox')} />
            )}
            <ToolButton label={inSpam ? 'Not spam' : 'Mark as spam'} icon={inSpam ? ShieldCheck : ShieldAlert} onClick={() => actions.spam(!inSpam)} />
            <ToolButton label={message.folder === 'trash' ? 'Delete forever' : 'Delete'} icon={Trash2} onClick={actions.remove} />
            <ToolButton label="Mark unread" icon={MailOpen} onClick={() => actions.markUnread(message)} />
            <ToolButton
              label={message.starred ? 'Unstar' : 'Star'}
              icon={Star}
              onClick={() => actions.star(message)}
              className={message.starred ? '[&_svg]:fill-notif [&_svg]:text-notif' : ''}
            />
          </>
        )}
        {readOnly && <span className="ml-auto pr-2 text-[12.5px] text-muted">Read-only: shared with you as a viewer</span>}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[820px] grid-cols-[minmax(0,1fr)] gap-5 px-4 py-6 md:px-10">
          <div className="flex flex-wrap gap-1.5">
            {section && !message.outgoing && <Chip color={section.color}>{section.title}</Chip>}
            {message.labels.filter((label) => label !== section?.title).map((label) => <Chip key={label} color="var(--muted)">{label}</Chip>)}
            <SecurityChip message={message} />
          </div>

          <h1 className="text-[23px] leading-tight font-bold tracking-tight text-balance">{message.subject}</h1>

          <div className="flex items-center gap-3">
            <Avatar name={message.from.name} size={40} />
            <div className="min-w-0">
              <div className="truncate">
                <b className="font-semibold">{message.from.name}</b>{' '}
                <span className="text-muted">&lt;{message.from.email}&gt;</span>
              </div>
              <div className="truncate text-[12.5px] text-muted">
                to {message.to.map((p) => p.name || p.email).join(', ') || 'undisclosed recipients'}
                {account && <> · <i className="inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: account.color }} /> {account.email}</>}
              </div>
            </div>
            <time className="ml-auto hidden shrink-0 text-[12.5px] text-muted sm:block" dateTime={message.date}>{formatFullDate(message.date)}</time>
          </div>

          {message.outgoing && message.scheduledFor && <ScheduledBar message={message} onDone={() => { onRefresh(); onBack() }} />}

          {detail.isLoading ? (
            <p className="text-muted" aria-busy="true">Loading message…</p>
          ) : message.security === 'pgp-encrypted' ? (
            <EncryptedBody message={message} />
          ) : (
            <Body message={message} />
          )}

          {message.event && !message.outgoing && <EventCard messageId={message.id} event={message.event} />}

          {message.attachments.length > 0 && (
            <div className="grid gap-2">
              <h2 className="text-[12px] font-semibold text-muted">{message.attachments.length} attachment{message.attachments.length > 1 && 's'}</h2>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {message.attachments.map((file) => (
                  <AttachmentTile key={file.id} messageId={message.id} file={file} outgoing={!!message.outgoing} onPreview={() => setPreview(file)} />
                ))}
              </div>
            </div>
          )}

          {!message.outgoing && (
            <button type="button" onClick={() => reply()} className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-left text-muted hover:border-sel-line">
              <Reply size={16} />
              Reply to {message.from.name.split(' ')[0]}…
            </button>
          )}
        </div>
      </div>

      {preview && <AttachmentPreview messageId={message.id} file={preview} onClose={() => setPreview(null)} />}
    </article>
  )
}

function ToolButton({ label, icon: Icon, onClick, showLabel = false, className = '' }: {
  label: string; icon: typeof Reply; onClick: () => void; showLabel?: boolean; className?: string
}) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-ink-2 hover:bg-raise ${className}`}>
      <Icon size={16} strokeWidth={1.8} />
      {showLabel && <span className="hidden lg:inline">{label}</span>}
    </button>
  )
}

function SecurityChip({ message }: { message: Message }) {
  switch (message.security) {
    case 'pgp-encrypted':
      return <Chip color="var(--news)"><Lock size={12} /> PGP encrypted</Chip>
    case 'pgp-signed':
      return <Chip color="var(--muted)"><ShieldCheck size={12} /> PGP signed</Chip>
    case 'smime-encrypted':
      return <Chip color="var(--news)"><Lock size={12} /> S/MIME encrypted</Chip>
    case 'smime-signed':
      if (message.signature === 'trusted') return <Chip color="var(--news)"><ShieldCheck size={12} /> S/MIME signed · verified</Chip>
      if (message.signature === 'untrusted') return <Chip color="var(--notif)"><ShieldCheck size={12} /> S/MIME signed · unverified issuer</Chip>
      if (message.signature === 'invalid') return <Chip color="var(--danger)"><ShieldX size={12} /> Signature broken: the message was changed</Chip>
      return <Chip color="var(--muted)"><ShieldCheck size={12} /> S/MIME signed</Chip>
    default:
      return null
  }
}

function Body({ message }: { message: Message }) {
  if (message.html) return <SafeHtml html={message.html} />
  if (message.text) return <div className="max-w-[65ch] text-[15px] leading-relaxed break-words whitespace-pre-wrap text-ink-2">{message.text}</div>
  return <p className="text-muted">This message has no text.</p>
}

// PGP decryption happens in the browser: the private key and passphrase never reach the server.
function EncryptedBody({ message }: { message: Message }) {
  const [plain, setPlain] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Inline PGP puts the armored text in the body; PGP/MIME sends it as an "encrypted.asc" part.
  async function armoredText(): Promise<string> {
    if (message.text?.includes('-----BEGIN PGP MESSAGE-----')) return message.text
    const part = message.attachments.find((a) => /\.asc$/i.test(a.filename) || a.contentType === 'application/octet-stream')
    if (!part) throw new Error('Could not find the encrypted part of this message')
    return (await fetch(attachmentUrl(message.id, part, true))).text()
  }

  async function decrypt(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    const passphrase = event ? String(new FormData(event.currentTarget).get('passphrase') ?? '') : ''
    setBusy(true)
    setError('')
    try {
      const key = await pgp.unlock(passphrase)
      setPlain(await pgp.decrypt(await armoredText(), key))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (plain !== null) return <div className="max-w-[65ch] text-[15px] leading-relaxed break-words whitespace-pre-wrap text-ink-2">{plain}</div>

  return (
    <form onSubmit={decrypt} className="grid gap-3 rounded-2xl border border-line bg-panel p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-raise text-news"><KeyRound size={18} /></span>
        <div>
          <p className="font-semibold">This message is encrypted with PGP</p>
          <p className="text-[13px] text-muted">It is decrypted here in your browser. Your passphrase never leaves this device.</p>
        </div>
      </div>
      {pgp.isUnlocked() ? (
        <Button variant="primary" className="justify-self-start" onClick={() => decrypt()} disabled={busy}>Decrypt</Button>
      ) : (
        <div className="flex gap-2">
          <Input name="passphrase" type="password" placeholder="Key passphrase" aria-label="Key passphrase" autoComplete="off" required />
          <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Decrypting…' : 'Decrypt'}</Button>
        </div>
      )}
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
    </form>
  )
}

function ScheduledBar({ message, onDone }: { message: Message; onDone: () => void }) {
  const [error, setError] = useState('')
  const act = async (work: () => Promise<unknown>) => {
    try {
      await work()
      onDone()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <div className="grid gap-2 rounded-xl border border-line bg-raise px-4 py-3">
      <div className="flex flex-wrap items-center gap-3 text-ink-2">
        {message.error ? <span className="text-danger">Sending failed: {message.error}</span> : <>Scheduled to send {formatFullDate(message.scheduledFor!)}</>}
        <Button variant="ghost" className="ml-auto" onClick={() => act(() => api(`/outgoing/${message.id}/send-now`, { body: {} }))}>Send now</Button>
        <Button variant="danger" onClick={() => act(() => api(`/outgoing/${message.id}`, { method: 'DELETE' }))}>Cancel</Button>
      </div>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
    </div>
  )
}

function EventCard({ messageId, event }: { messageId: string; event: CalendarEvent }) {
  const [state, setState] = useState<{ busy?: boolean; added?: string; error?: string }>({})
  const calendars = (usePlugins().data ?? []).filter((p) => p.enabled && p.capabilities.includes('create-event'))
  const start = new Date(event.start)

  async function add(pluginId: string, name: string) {
    setState({ busy: true })
    try {
      await api(`/plugins/${pluginId}/create-event`, { body: { messageId } })
      setState({ added: name })
    } catch (e) {
      setState({ error: (e as Error).message })
    }
  }

  return (
    <div className="grid gap-2 rounded-2xl border border-[color-mix(in_srgb,var(--travel)_30%,transparent)] bg-[color-mix(in_srgb,var(--travel)_10%,transparent)] p-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="w-12 overflow-hidden rounded-[10px] bg-ground text-center">
          <b className="block bg-travel py-0.5 text-[11px] tracking-wider text-[#0e0f12]">{start.toLocaleString([], { month: 'short' }).toUpperCase()}</b>
          <span className="block py-1 text-[19px] font-bold">{start.getDate()}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{event.title}</p>
          <p className="text-[13px] text-muted">{formatFullDate(event.start)}{event.location && ` · ${event.location}`}</p>
          {event.detail && <p className="text-[13px] text-muted">{event.detail}</p>}
        </div>
        <div className="flex gap-2">
          <a href={`/api/messages/${messageId}/event.ics`} className="rounded-lg p-2 text-ink-2 hover:bg-raise" title="Download .ics" aria-label="Download calendar file">
            <Download size={15} />
          </a>
          {calendars.map((plugin) => (
            <Button key={plugin.id} variant="primary" onClick={() => add(plugin.id, plugin.name)} disabled={state.busy || !!state.added}>
              {state.added === plugin.name ? <Check size={15} /> : <CalendarPlus size={15} />}
              {state.added === plugin.name ? `Added to ${plugin.name}` : `Add to ${plugin.name}`}
            </Button>
          ))}
        </div>
      </div>
      {state.error && <p role="alert" className="text-[13px] text-danger">{state.error}</p>}
    </div>
  )
}

const canPreview = (file: Attachment) => /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/.test(file.contentType)

function AttachmentTile({ messageId, file, outgoing, onPreview }: { messageId: string; file: Attachment; outgoing: boolean; onPreview: () => void }) {
  const Icon = file.contentType.startsWith('image/') ? Image : FileText
  const previewable = canPreview(file) && !outgoing
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-raise p-2.5">
      <button type="button" onClick={onPreview} disabled={!previewable} aria-label={`Preview ${file.filename}`} className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-line/60 text-muted enabled:hover:text-ink">
        {file.contentType.startsWith('image/') && previewable ? <img src={attachmentUrl(messageId, file)} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Icon size={18} />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate">{file.filename}</p>
        <p className="text-[12px] text-muted">{formatSize(file.size)}</p>
      </div>
      {previewable && (
        <button type="button" onClick={onPreview} aria-label={`Preview ${file.filename}`} className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-ink">
          <Eye size={15} />
        </button>
      )}
      {!outgoing && (
        <>
          <a href={attachmentUrl(messageId, file, true)} aria-label={`Download ${file.filename}`} className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-ink">
            <Download size={15} />
          </a>
          <SaveToMenu messageId={messageId} attachmentId={file.id} filename={file.filename} compact />
        </>
      )}
    </div>
  )
}

function AttachmentPreview({ messageId, file, onClose }: { messageId: string; file: Attachment; onClose: () => void }) {
  const url = attachmentUrl(messageId, file)
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/85" role="dialog" aria-modal="true" aria-label={`Preview of ${file.filename}`}>
      <header className="flex items-center gap-3 px-4 py-3 text-white">
        <span className="truncate font-semibold">{file.filename}</span>
        <span className="text-[12px] text-white/70">{formatSize(file.size)}</span>
        <div className="ml-auto flex items-center gap-2">
          <SaveToMenu messageId={messageId} attachmentId={file.id} filename={file.filename} />
          <a href={attachmentUrl(messageId, file, true)} className="flex items-center gap-1.5 rounded-lg border border-line bg-raise px-3 py-1.5 text-[13px] text-ink"><Download size={15} /> Download</a>
          <button type="button" aria-label="Close preview" onClick={onClose} className="rounded-lg p-2 hover:bg-white/10"><X size={18} /></button>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 place-items-center p-4 md:p-8" onClick={onClose}>
        {file.contentType.startsWith('image/') ? (
          <img src={url} alt={file.filename} className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
        ) : (
          // The server sends text with a sandbox policy; PDFs open in the browser's own viewer.
          <iframe title={file.filename} src={url} className="h-full w-full max-w-4xl rounded-lg bg-white" onClick={(e) => e.stopPropagation()} />
        )}
      </div>
    </div>
  )
}
