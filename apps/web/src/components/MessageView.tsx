import {
  Archive, ArrowLeft, CalendarPlus, Check, Download, Eye, FileText, Forward, Image, KeyRound, Lock, Reply, ReplyAll, ShieldAlert, ShieldCheck, Star, Trash2, X,
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { accounts, plugins } from '../mock/data'
import { formatFullDate, formatSize, replySubject } from '../lib/format'
import { useStore } from '../lib/store'
import type { Attachment, CalendarEvent, Message } from '../types'
import { sections } from './MessageList'
import { SafeHtml } from './SafeHtml'
import { SaveToMenu } from './SaveToMenu'
import { Avatar, Button, Chip, Input } from './ui'

interface Props {
  message: Message
  onBack: () => void
  onArchive: () => void
  onDelete: () => void
  onSpam: () => void
}

export function MessageView({ message, onBack, onArchive, onDelete, onSpam }: Props) {
  const { updateMessage, openComposer } = useStore()
  const [preview, setPreview] = useState<Attachment | null>(null)
  const account = accounts.find((a) => a.id === message.accountId)
  const section = sections.find((s) => s.category === message.category)

  const reply = (all = false) =>
    openComposer({
      to: message.from.email,
      cc: all ? (message.cc ?? []).map((p) => p.email).join(', ') : '',
      subject: replySubject(message.subject),
      replyTo: message,
    })
  const forward = () => openComposer({ subject: replySubject(message.subject, 'Fwd'), replyTo: message })

  return (
    <article className="flex h-full flex-col overflow-hidden bg-read" aria-label={message.subject}>
      <div className="flex items-center gap-0.5 border-b border-line px-2 py-2 md:px-4">
        <ToolButton label="Back" icon={ArrowLeft} onClick={onBack} className="md:hidden" />
        <ToolButton label="Reply" icon={Reply} onClick={() => reply()} showLabel />
        <ToolButton label="Reply all" icon={ReplyAll} onClick={() => reply(true)} />
        <ToolButton label="Forward" icon={Forward} onClick={forward} showLabel />
        <span className="mx-1 h-5 w-px bg-line" />
        <ToolButton label="Archive" icon={Archive} onClick={onArchive} />
        <ToolButton label="Mark as spam" icon={ShieldAlert} onClick={onSpam} />
        <ToolButton label="Delete" icon={Trash2} onClick={onDelete} />
        <ToolButton
          label={message.starred ? 'Unstar' : 'Star'}
          icon={Star}
          onClick={() => updateMessage(message.id, { starred: !message.starred })}
          className={message.starred ? '[&_svg]:fill-notif [&_svg]:text-notif' : ''}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[820px] grid-cols-[minmax(0,1fr)] gap-5 px-4 py-6 md:px-10">
          <div className="flex flex-wrap gap-1.5">
            {section && <Chip color={section.color}>{section.title}</Chip>}
            {message.labels.filter((label) => label !== section?.title).map((label) => <Chip key={label} color="var(--muted)">{label}</Chip>)}
            <SecurityChip security={message.security} />
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
                to {message.to.map((p) => p.name || p.email).join(', ')}
                {account && <> · <i className="inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: account.color }} /> {account.email}</>}
              </div>
            </div>
            <time className="ml-auto hidden shrink-0 text-[12.5px] text-muted sm:block" dateTime={message.date}>{formatFullDate(message.date)}</time>
          </div>

          {message.scheduledFor && (
            <div className="flex items-center gap-3 rounded-xl border border-line bg-raise px-4 py-3 text-ink-2">
              Scheduled to send {formatFullDate(message.scheduledFor)}
              <Button variant="ghost" className="ml-auto">Send now</Button>
              <Button variant="danger">Cancel</Button>
            </div>
          )}

          {message.security === 'pgp-encrypted' ? <EncryptedBody /> : <Body message={message} />}

          {message.event && <EventCard event={message.event} />}

          {message.attachments.length > 0 && (
            <div className="grid gap-2">
              <h2 className="text-[12px] font-semibold text-muted">{message.attachments.length} attachment{message.attachments.length > 1 && 's'}</h2>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {message.attachments.map((file) => <AttachmentTile key={file.id} file={file} onPreview={() => setPreview(file)} />)}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => reply()}
            className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-left text-muted hover:border-sel-line"
          >
            <Reply size={16} />
            Reply to {message.from.name.split(' ')[0]}…
          </button>
        </div>
      </div>

      {preview && <AttachmentPreview file={preview} onClose={() => setPreview(null)} />}
    </article>
  )
}

function ToolButton({ label, icon: Icon, onClick, showLabel = false, className = '' }: {
  label: string; icon: typeof Reply; onClick: () => void; showLabel?: boolean; className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-ink-2 hover:bg-raise ${className}`}
    >
      <Icon size={16} strokeWidth={1.8} />
      {showLabel && <span className="hidden lg:inline">{label}</span>}
    </button>
  )
}

function SecurityChip({ security }: { security: Message['security'] }) {
  if (!security) return null
  const labels = {
    'pgp-encrypted': 'PGP encrypted',
    'pgp-signed': 'PGP signed · verified',
    'smime-signed': 'S/MIME signed · verified',
    'smime-encrypted': 'S/MIME encrypted',
  }
  return (
    <Chip color="var(--news)">
      {security.endsWith('encrypted') ? <Lock size={12} /> : <ShieldCheck size={12} />}
      {labels[security]}
    </Chip>
  )
}

function Body({ message }: { message: Message }) {
  if (message.html) return <SafeHtml html={message.html} />
  return <div className="max-w-[65ch] text-[15px] leading-relaxed whitespace-pre-wrap text-ink-2">{message.text}</div>
}

// PGP decryption happens in the browser: the private key and passphrase never reach the server.
function EncryptedBody() {
  const [state, setState] = useState<'locked' | 'error' | 'open'>('locked')

  function decrypt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const passphrase = new FormData(event.currentTarget).get('passphrase')
    setState(passphrase ? 'open' : 'error')
  }

  if (state === 'open') {
    return (
      <div className="max-w-[65ch] text-[15px] leading-relaxed whitespace-pre-wrap text-ink-2">
        {'Hi Ali,\n\nAttached is the Q4 infra budget. We are cutting the second Hetzner box and moving backups to the NAS.\n\nPriya'}
      </div>
    )
  }

  return (
    <form onSubmit={decrypt} className="grid gap-3 rounded-2xl border border-line bg-panel p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-raise text-news"><KeyRound size={18} /></span>
        <div>
          <p className="font-semibold">This message is encrypted with PGP</p>
          <p className="text-[13px] text-muted">Decrypted in your browser with key 3A1F 9C22. Your passphrase never leaves this device.</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Input name="passphrase" type="password" placeholder="Key passphrase" aria-label="Key passphrase" autoComplete="off" />
        <Button type="submit" variant="primary">Decrypt</Button>
      </div>
      {state === 'error' && <p role="alert" className="text-[13px] text-danger">Enter your passphrase to decrypt.</p>}
    </form>
  )
}

function EventCard({ event }: { event: CalendarEvent }) {
  const [added, setAdded] = useState(false)
  const calendarPlugin = plugins.find((p) => p.enabled && p.capabilities.includes('create-event'))
  const start = new Date(event.start)
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-[color-mix(in_srgb,var(--travel)_30%,transparent)] bg-[color-mix(in_srgb,var(--travel)_10%,transparent)] p-4">
      <div className="w-12 overflow-hidden rounded-[10px] bg-ground text-center">
        <b className="block bg-travel py-0.5 text-[11px] tracking-wider text-[#0e0f12]">{start.toLocaleString([], { month: 'short' }).toUpperCase()}</b>
        <span className="block py-1 text-[19px] font-bold">{start.getDate()}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{event.title}</p>
        <p className="text-[13px] text-muted">{formatFullDate(event.start)} · {event.location}</p>
        {event.detail && <p className="text-[13px] text-muted">{event.detail}</p>}
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" title="Download .ics"><Download size={15} /></Button>
        {calendarPlugin && (
          <Button variant="primary" onClick={() => setAdded(true)} disabled={added}>
            {added ? <Check size={15} /> : <CalendarPlus size={15} />}
            {added ? `Added to ${calendarPlugin.name}` : `Add to ${calendarPlugin.name}`}
          </Button>
        )}
      </div>
    </div>
  )
}

const canPreview = (file: Attachment) => /^image\/|^application\/pdf$|^text\/plain$/.test(file.contentType)

function AttachmentTile({ file, onPreview }: { file: Attachment; onPreview: () => void }) {
  const Icon = file.contentType.startsWith('image/') ? Image : FileText
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-raise p-2.5">
      <button
        type="button"
        onClick={onPreview}
        disabled={!canPreview(file)}
        aria-label={`Preview ${file.filename}`}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-line/60 text-muted enabled:hover:text-ink"
      >
        <Icon size={18} />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate">{file.filename}</p>
        <p className="text-[12px] text-muted">{formatSize(file.size)}</p>
      </div>
      {canPreview(file) && (
        <button type="button" onClick={onPreview} aria-label={`Preview ${file.filename}`} className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-ink">
          <Eye size={15} />
        </button>
      )}
      <button type="button" aria-label={`Download ${file.filename}`} className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-ink">
        <Download size={15} />
      </button>
      <SaveToMenu filename={file.filename} compact />
    </div>
  )
}

function AttachmentPreview({ file, onClose }: { file: Attachment; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80" role="dialog" aria-modal="true" aria-label={`Preview of ${file.filename}`}>
      <header className="flex items-center gap-3 px-4 py-3 text-white">
        <span className="truncate font-semibold">{file.filename}</span>
        <span className="text-[12px] text-white/70">{formatSize(file.size)}</span>
        <div className="ml-auto flex items-center gap-2">
          <SaveToMenu filename={file.filename} />
          <Button variant="secondary"><Download size={15} /> Download</Button>
          <button type="button" aria-label="Close preview" onClick={onClose} className="rounded-lg p-2 hover:bg-white/10"><X size={18} /></button>
        </div>
      </header>
      <div className="grid flex-1 place-items-center p-6" onClick={onClose}>
        <div className="grid aspect-[4/3] w-full max-w-3xl place-items-center rounded-xl bg-gradient-to-br from-[#2a2b33] to-[#17181d] text-white/60" onClick={(e) => e.stopPropagation()}>
          {file.contentType.startsWith('image/') ? <Image size={48} /> : <FileText size={48} />}
          <span className="sr-only">Preview placeholder in the UI mock</span>
        </div>
      </div>
    </div>
  )
}
