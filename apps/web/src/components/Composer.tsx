import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Clock, Lock, Maximize2, Minimize2, Paperclip, Send, ShieldCheck, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, del, fileToBase64, put } from '../lib/api'
import { htmlToText, quoteReply, withHtmlSignature, type BodyMode } from '../lib/compose'
import { formatFullDate, formatSize } from '../lib/format'
import * as pgp from '../lib/pgp'
import { useAccounts, useMe, useRefreshMail } from '../lib/queries'
import { useStore } from '../lib/store'
import { BodyEditor } from './BodyEditor'
import { RecipientField } from './RecipientField'
import { Button, Input, Toggle } from './ui'

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
  const me = useMe().data
  const refresh = useRefreshMail()
  // Viewers of a shared account can read it but not send from it.
  const accounts = (useAccounts().data ?? []).filter((a) => a.role !== 'viewer')
  const smimeCerts = useQuery({ queryKey: ['smime'], queryFn: () => api<{ email: string }[]>('/smime') }).data ?? []

  const [draftId, setDraftId] = useState(draft?.id)
  const [to, setTo] = useState(splitEmails(draft?.to ?? ''))
  const [cc, setCc] = useState(splitEmails(draft?.cc ?? ''))
  const [bcc, setBcc] = useState(splitEmails(draft?.bcc ?? ''))
  const [showCopies, setShowCopies] = useState(cc.length + bcc.length > 0)
  const [subject, setSubject] = useState(draft?.subject ?? '')
  const [fromId, setFromId] = useState(draft?.accountId ?? draft?.replyTo?.accountId ?? '')
  const [files, setFiles] = useState<File[]>([])
  const [encrypt, setEncrypt] = useState(false)
  const [sign, setSign] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [size, setSize] = useState<'normal' | 'max' | 'min'>('normal')
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState('')
  // Mail is written as rich text; the user can switch to editing the raw HTML.
  const [mode, setMode] = useState<BodyMode>('rich')
  const [content, setContent] = useState('')
  const [version, setVersion] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)

  const account = accounts.find((a) => a.id === fromId) ?? accounts[0]
  const recipients = [...to, ...cc, ...bcc]
  const forwarded = draft?.forwardOf ? (draft.replyTo?.attachments ?? []) : []
  const bccOnly = to.length === 0 && cc.length === 0 && bcc.length > 0
  // S/MIME when there's a certificate for this address, otherwise PGP.
  const method = account && smimeCerts.some((c) => c.email === account.email) ? 'S/MIME' : 'PGP'
  const needsPassphrase = method === 'PGP' && sign && !pgp.isUnlocked()

  function replaceContent(next: string) {
    setContent(next)
    setVersion((v) => v + 1)
  }

  // Fill the body once the account (and so its signature) is known.
  useEffect(() => {
    if (!account || version > 0) return
    if (!fromId) setFromId(account.id)
    if (draft?.html) return replaceContent(draft.html)
    const original = draft?.replyTo
    const quote = original ? quoteReply(`On ${formatFullDate(original.date)}, ${original.from.name} wrote:`, original.text ?? original.preview) : '<p><br></p>'
    replaceContent(withHtmlSignature(quote, account.signature))
  }, [account?.id])

  function changeAccount(accountId: string) {
    setFromId(accountId)
    replaceContent(withHtmlSignature(content, accounts.find((a) => a.id === accountId)?.signature ?? ''))
  }

  async function payload() {
    const attachments = await Promise.all(files.map(async (f) => ({ filename: f.name, contentType: f.type || 'application/octet-stream', content: await fileToBase64(f) })))
    const base = { accountId: account!.id, to, cc, bcc, subject, html: content, text: htmlToText(content), attachments, inReplyTo: draft?.replyTo?.messageId ?? undefined, forwardOf: draft?.forwardOf }
    if (!encrypt && !sign) return base
    if (method === 'S/MIME') return { ...base, smime: { encrypt, sign } }

    // PGP runs here in the browser. PGP mail is plain text, so the HTML version is not sent.
    const signingKey = sign ? await pgp.unlock(passphrase) : undefined
    if (encrypt) {
      // Only the text is encrypted with PGP here; files would go out readable, so refuse rather than leak.
      if (attachments.length || draft?.forwardOf) throw new Error('PGP encryption covers the message text only. Remove the attachments, or use S/MIME for encrypted attachments.')
      const { keys, ownKey } = await api<{ keys: Record<string, string | null>; ownKey: string | null }>('/pgp/recipients', { body: { emails: recipients } })
      const missing = recipients.filter((email) => !keys[email])
      if (missing.length) throw new Error(`No PGP key for ${missing.join(', ')}. Add their key to the contact, or turn off encryption.`)
      // Also encrypt to yourself, or you couldn't read your own Sent copy.
      const armored = await pgp.encryptText(base.text, [...Object.values(keys).filter(Boolean), ownKey].filter(Boolean) as string[], signingKey)
      return { ...base, html: undefined, text: armored }
    }
    return { ...base, html: undefined, text: await pgp.signText(base.text, signingKey!) }
  }

  async function send(scheduledFor?: Date) {
    setScheduleOpen(false)
    if (!account) return setError('Add a mail account in Settings first.')
    if (recipients.length === 0) return setError('Add at least one recipient in To, Cc or Bcc.')
    setBusy(true)
    setError('')
    try {
      await api('/send', { body: { ...(await payload()), scheduledFor: scheduledFor?.toISOString(), draftId } })
      setSent(scheduledFor ? `Scheduled for ${formatFullDate(scheduledFor.toISOString())}` : 'Message sent')
      refresh()
      setTimeout(closeComposer, 1200)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Closing keeps unfinished mail as a draft; the bin discards it.
  async function close() {
    const hasContent = recipients.length || subject.trim() || htmlToText(withHtmlSignature(content, '')).trim()
    if (account && hasContent && !sent) {
      try {
        const saved = await put<{ id: string }>('/drafts', { id: draftId, accountId: account.id, to, cc, bcc, subject, html: content, text: htmlToText(content), forwardOf: draft?.forwardOf })
        setDraftId(saved.id)
        refresh()
      } catch (e) {
        return setError(`Could not save the draft: ${(e as Error).message}`)
      }
    }
    closeComposer()
  }

  async function discard() {
    if (draftId) await del(`/outgoing/${draftId}`).catch(() => undefined)
    refresh()
    closeComposer()
  }

  const placement = {
    normal: 'md:right-4 md:bottom-0 md:h-[min(600px,calc(100dvh-1rem))] md:w-[620px] md:rounded-t-2xl',
    max: 'md:inset-6 md:rounded-2xl',
    min: 'md:right-4 md:bottom-0 md:h-auto md:w-[360px] md:rounded-t-2xl',
  }[size]

  return (
    <section
      aria-label="New message"
      className={`fixed inset-0 z-30 flex flex-col overflow-hidden border-line bg-panel md:border shadow-pop md:inset-auto ${placement}`}
      onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send() }}
    >
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <h2 className="truncate font-semibold">{subject || 'New message'}</h2>
        <div className="ml-auto flex items-center gap-0.5 text-muted">
          <button type="button" aria-label={size === 'min' ? 'Restore' : 'Minimize'} onClick={() => setSize(size === 'min' ? 'normal' : 'min')} className="hidden rounded-md p-1.5 hover:bg-raise md:block">
            <Minimize2 size={15} />
          </button>
          <button type="button" aria-label={size === 'max' ? 'Restore' : 'Expand'} onClick={() => setSize(size === 'max' ? 'normal' : 'max')} className="hidden rounded-md p-1.5 hover:bg-raise md:block">
            <Maximize2 size={15} />
          </button>
          <button type="button" aria-label="Close and keep draft" title="Close and keep draft" onClick={close} className="rounded-md p-1.5 hover:bg-raise">
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
            {account ? (
              // The native select stays for keyboard and screen readers, but is invisible and laid over
              // the label, so the caret sits right after the selected address instead of the longest one.
              <label className="relative flex min-w-0 items-center gap-1 rounded-md px-1 text-ink focus-within:ring-2 focus-within:ring-accent hover:bg-raise">
                <span className="truncate">{me?.name} &lt;{account.email}&gt;</span>
                <ChevronDown size={14} className="shrink-0 text-muted" />
                <select value={account.id} onChange={(e) => changeAccount(e.target.value)} aria-label="Send from" className="absolute inset-0 cursor-pointer opacity-0">
                  {accounts.map((a) => <option key={a.id} value={a.id}>{me?.name} &lt;{a.email}&gt;</option>)}
                </select>
              </label>
            ) : (
              <span className="text-muted">No account to send from yet</span>
            )}
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

          <BodyEditor mode={mode} content={content} version={version} onChange={setContent} onModeChange={setMode} />

          {forwarded.length > 0 && (
            <p className="px-4 pb-1 text-[12.5px] text-muted">
              <Paperclip size={12} className="mr-1 inline" />
              Forwarding {forwarded.map((a) => a.filename).join(', ')}
            </p>
          )}
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

          {needsPassphrase && (
            <div className="flex items-center gap-2 border-t border-line px-4 py-2">
              <span className="shrink-0 text-[13px] text-muted">PGP passphrase to sign</span>
              <Input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} aria-label="PGP key passphrase" autoComplete="off" />
            </div>
          )}
          {(encrypt || sign) && method === 'PGP' && (
            <p className="px-4 pb-1 text-[12.5px] text-muted">PGP mail is sent as plain text; formatting and inline images are left out.</p>
          )}
          {error && <p role="alert" className="px-4 pb-2 text-[13px] text-danger">{error}</p>}

          <footer className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2.5">
            <div className="relative flex">
              <Button variant="primary" className="rounded-r-none" onClick={() => send()} disabled={busy} title="Send (⌘↵)">
                <Send size={15} /> {busy ? 'Sending…' : 'Send'}
              </Button>
              <Button variant="primary" className="rounded-l-none border-l border-black/15 px-2" aria-label="Schedule send" aria-expanded={scheduleOpen} disabled={busy} onClick={() => setScheduleOpen(!scheduleOpen)}>
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
                  <form className="flex items-center gap-2 rounded-lg px-2.5 py-2" onSubmit={(e) => { e.preventDefault(); const at = new FormData(e.currentTarget).get('at'); if (at) send(new Date(String(at))) }}>
                    <Clock size={14} className="shrink-0 text-muted" />
                    <input name="at" type="datetime-local" required aria-label="Pick date and time" className="min-w-0 flex-1 bg-transparent text-ink focus:outline-none" />
                    <Button type="submit" variant="ghost" className="px-2">Set</Button>
                  </form>
                </div>
              )}
            </div>

            <button type="button" aria-label="Attach files" title="Attach files" onClick={() => fileInput.current?.click()} className="rounded-md p-1.5 text-muted hover:bg-raise hover:text-ink">
              <Paperclip size={16} />
            </button>
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])]); e.target.value = '' }} />

            <div className="flex items-center divide-x divide-line rounded-lg border border-line text-[13px] text-ink-2">
              <label className="flex items-center gap-2 px-3 py-1.5" title={`Encrypt with ${method}`}>
                <Lock size={14} className={encrypt ? 'text-news' : 'text-muted'} /> Encrypt
                <Toggle checked={encrypt} onChange={setEncrypt} label={`Encrypt with ${method}`} />
              </label>
              <label className="flex items-center gap-2 px-3 py-1.5" title={`Sign with ${method}`}>
                <ShieldCheck size={14} className={sign ? 'text-news' : 'text-muted'} /> Sign
                <Toggle checked={sign} onChange={setSign} label={`Sign with ${method}`} />
              </label>
              {(encrypt || sign) && <span className="px-2.5 py-1.5 text-[12px] text-muted">{method}</span>}
            </div>

            <button type="button" aria-label="Discard draft" title="Discard draft" onClick={discard} className="ml-auto rounded-md p-1.5 text-muted hover:bg-raise hover:text-danger">
              <Trash2 size={16} />
            </button>
          </footer>
        </>
      )}
    </section>
  )
}
