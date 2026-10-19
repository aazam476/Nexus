import { ChevronDown, Clock, Lock, Maximize2, Minimize2, Paperclip, Send, ShieldCheck, Trash2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { accounts, me } from '../mock/data'
import { formatFullDate, formatSize } from '../lib/format'
import { useStore } from '../lib/store'
import { htmlToText, quoteReply, textToHtml, withHtmlSignature, withPlainSignature, type BodyMode } from '../lib/compose'
import { BodyEditor } from './BodyEditor'
import { RecipientField, hasPgpKey } from './RecipientField'
import { Button, Toggle } from './ui'

const splitEmails = (value: string) => value.split(',').map((e) => e.trim()).filter(Boolean)

function scheduleOptions() {
  const at = (days: number, hour: number) => {
    const d = new Date()
    d.setDate(d.getDate() + days)
    d.setHours(hour, 0, 0, 0)
    return d
  }
  const nextMonday = at((8 - new Date().getDay()) % 7 || 7, 8)
  return [
    { label: 'Tomorrow morning', date: at(1, 8) },
    { label: 'Tomorrow afternoon', date: at(1, 13) },
    { label: 'Monday morning', date: nextMonday },
  ]
}

export function Composer() {
  const { draft, closeComposer } = useStore()
  const [to, setTo] = useState(splitEmails(draft?.to ?? ''))
  const [cc, setCc] = useState(splitEmails(draft?.cc ?? ''))
  const [bcc, setBcc] = useState(splitEmails(draft?.bcc ?? ''))
  const [showCopies, setShowCopies] = useState(cc.length > 0)
  const [subject, setSubject] = useState(draft?.subject ?? '')
  const [fromId, setFromId] = useState(draft?.replyTo?.accountId ?? accounts[0].id)
  const [files, setFiles] = useState<File[]>([])
  const [encrypt, setEncrypt] = useState(false)
  const [sign, setSign] = useState(true)
  const [size, setSize] = useState<'normal' | 'max' | 'min'>('normal')
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState('')
  const signatureOf = (accountId: string) => accounts.find((a) => a.id === accountId)?.signature ?? ''
  // New mail starts as plain text; the user can switch to rich text or raw HTML.
  const [mode, setMode] = useState<BodyMode>('plain')
  const [content, setContent] = useState(() => {
    const original = draft?.replyTo
    const quote = original ? quoteReply('plain', `On ${formatFullDate(original.date)}, ${original.from.name} wrote:`, original.text ?? original.preview) : ''
    return withPlainSignature(quote, signatureOf(fromId))
  })
  const [version, setVersion] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)

  const recipients = [...to, ...cc, ...bcc]
  const missingKeys = encrypt ? recipients.filter((email) => !hasPgpKey(email)) : []
  const bccOnly = to.length === 0 && cc.length === 0 && bcc.length > 0

  function replaceContent(next: string) {
    setContent(next)
    setVersion((v) => v + 1)
  }

  function changeMode(next: BodyMode) {
    if (next === mode) return
    const signature = signatureOf(fromId)
    if (mode === 'plain') {
      replaceContent(withHtmlSignature(textToHtml(withPlainSignature(content, '')), signature))
    } else if (next === 'plain') {
      const html = withHtmlSignature(content, '')
      if (/<(img|a|b|strong|i|em|u|ul|ol|table)\b/i.test(html) && !confirm('Switching to plain text removes formatting, links and inline images. Continue?')) return
      replaceContent(withPlainSignature(htmlToText(html), signature))
    } else {
      replaceContent(content) // rich <-> HTML source share the same HTML
    }
    setMode(next)
  }

  function changeAccount(accountId: string) {
    setFromId(accountId)
    const signature = signatureOf(accountId)
    replaceContent(mode === 'plain' ? withPlainSignature(content, signature) : withHtmlSignature(content, signature))
  }

  function send(scheduledFor?: Date) {
    if (recipients.length === 0) return setError('Add at least one recipient in To, Cc or Bcc.')
    if (missingKeys.length) return setError(`No PGP key for ${missingKeys.join(', ')}. Remove them or turn off encryption.`)
    setError('')
    setSent(scheduledFor ? `Scheduled for ${formatFullDate(scheduledFor.toISOString())}` : 'Message sent')
    setTimeout(closeComposer, 1200)
  }

  const placement = {
    normal: 'md:right-4 md:bottom-0 md:h-[600px] md:w-[620px] md:rounded-t-2xl',
    max: 'md:inset-6 md:rounded-2xl',
    min: 'md:right-4 md:bottom-0 md:h-auto md:w-[360px] md:rounded-t-2xl',
  }[size]

  return (
    <section
      aria-label="New message"
      className={`fixed inset-0 z-30 flex flex-col overflow-hidden border border-line bg-panel shadow-pop md:inset-auto ${placement}`}
      onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send() }}
    >
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <h2 className="font-semibold">{subject || 'New message'}</h2>
        <div className="ml-auto flex items-center gap-0.5 text-muted">
          <button type="button" aria-label={size === 'min' ? 'Restore' : 'Minimize'} onClick={() => setSize(size === 'min' ? 'normal' : 'min')} className="hidden rounded-md p-1.5 hover:bg-raise md:block">
            <Minimize2 size={15} />
          </button>
          <button type="button" aria-label={size === 'max' ? 'Restore' : 'Expand'} onClick={() => setSize(size === 'max' ? 'normal' : 'max')} className="hidden rounded-md p-1.5 hover:bg-raise md:block">
            <Maximize2 size={15} />
          </button>
          <button type="button" aria-label="Close and keep draft" onClick={closeComposer} className="rounded-md p-1.5 hover:bg-raise">
            <X size={16} />
          </button>
        </div>
      </header>

      {sent ? (
        <div className="grid flex-1 place-items-center p-10 text-center">
          <div className="grid justify-items-center gap-2">
            <span className="accent-gradient grid h-12 w-12 place-items-center rounded-2xl text-accent-ink"><Send size={20} /></span>
            <p className="font-semibold">{sent}</p>
          </div>
        </div>
      ) : size !== 'min' && (
        <>
          <div className="flex items-center gap-2 border-b border-line px-4 py-2">
            <span className="w-9 text-[13px] text-muted">From</span>
            <select value={fromId} onChange={(e) => changeAccount(e.target.value)} aria-label="Send from" className="bg-transparent text-ink focus:outline-none">
              {accounts.map((a) => <option key={a.id} value={a.id} className="bg-panel">{me.name} &lt;{a.email}&gt;</option>)}
            </select>
            {!showCopies && (
              <button type="button" onClick={() => setShowCopies(true)} className="ml-auto text-[13px] text-muted hover:text-ink">Cc / Bcc</button>
            )}
          </div>
          <RecipientField label="To" value={to} onChange={setTo} autoFocus={!draft?.to} />
          {showCopies && (
            <>
              <RecipientField label="Cc" value={cc} onChange={setCc} />
              <RecipientField label="Bcc" value={bcc} onChange={setBcc} />
            </>
          )}
          {bccOnly && (
            <p className="border-b border-line bg-raise px-4 py-1.5 text-[12.5px] text-muted">
              Sending to Bcc only. Recipients won’t see each other, and the To line will show “undisclosed recipients”.
            </p>
          )}
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            aria-label="Subject"
            className="border-b border-line bg-transparent px-4 py-2.5 font-semibold placeholder:font-normal placeholder:text-muted focus:outline-none"
          />

          <BodyEditor mode={mode} content={content} version={version} onChange={setContent} onModeChange={changeMode} />

          {files.length > 0 && (
            <ul className="flex flex-wrap gap-2 px-4 pb-2">
              {files.map((file) => (
                <li key={file.name} className="flex items-center gap-2 rounded-lg border border-line bg-raise px-2.5 py-1.5 text-[13px]">
                  <Paperclip size={13} className="text-muted" />
                  {file.name} <span className="text-muted">{formatSize(file.size)}</span>
                  <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles(files.filter((f) => f !== file))} className="text-muted hover:text-ink"><X size={13} /></button>
                </li>
              ))}
            </ul>
          )}

          {error && <p role="alert" className="px-4 pb-2 text-[13px] text-danger">{error}</p>}

          <footer className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2.5">
            <div className="relative flex">
              <Button variant="primary" className="rounded-r-none" onClick={() => send()} title="Send (⌘↵)">
                <Send size={15} /> Send
              </Button>
              <Button variant="primary" className="rounded-l-none border-l border-black/15 px-2" aria-label="Schedule send" aria-expanded={scheduleOpen} onClick={() => setScheduleOpen(!scheduleOpen)}>
                <ChevronDown size={15} />
              </Button>
              {scheduleOpen && (
                <div role="menu" className="absolute bottom-full left-0 z-10 mb-2 w-64 rounded-xl border border-line bg-panel p-1 shadow-pop">
                  <p className="px-2.5 pt-1.5 pb-1 text-[12px] font-semibold text-muted">Schedule send</p>
                  {scheduleOptions().map(({ label, date }) => (
                    <button key={label} type="button" role="menuitem" onClick={() => send(date)} className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left hover:bg-raise">
                      {label}
                      <span className="text-[12px] text-muted">{date.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    </button>
                  ))}
                  <label className="flex items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-raise">
                    <Clock size={14} className="text-muted" />
                    <input type="datetime-local" aria-label="Pick date and time" className="flex-1 bg-transparent text-ink focus:outline-none" onChange={(e) => e.target.value && send(new Date(e.target.value))} />
                  </label>
                </div>
              )}
            </div>

            <button type="button" aria-label="Attach files" title="Attach files" onClick={() => fileInput.current?.click()} className="rounded-md p-1.5 text-muted hover:bg-raise hover:text-ink">
              <Paperclip size={16} />
            </button>
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])} />

            <label className="flex items-center gap-2 text-[13px] text-ink-2" title="Encrypt with recipients’ PGP keys, in your browser">
              <Toggle checked={encrypt} onChange={setEncrypt} label="Encrypt with PGP" />
              <Lock size={14} className={encrypt ? 'text-news' : 'text-muted'} /> Encrypt
            </label>
            <label className="flex items-center gap-2 text-[13px] text-ink-2" title="Sign with your PGP key">
              <Toggle checked={sign} onChange={setSign} label="Sign" />
              <ShieldCheck size={14} className={sign ? 'text-news' : 'text-muted'} /> Sign
            </label>

            <button type="button" aria-label="Discard draft" title="Discard draft" onClick={closeComposer} className="ml-auto rounded-md p-1.5 text-muted hover:bg-raise hover:text-danger">
              <Trash2 size={16} />
            </button>
          </footer>
          {encrypt && missingKeys.length > 0 && !error && (
            <p className="px-4 pb-2.5 text-[12.5px] text-notif">No PGP key for {missingKeys.join(', ')}. They can’t read an encrypted message.</p>
          )}
        </>
      )}
    </section>
  )
}
