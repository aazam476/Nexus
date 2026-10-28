// Writing a message: recipients, subject, body, attachments, encryption, and sending now or later.
// Closing it keeps what you wrote as a draft; the bin button throws it away.
//
// The parts live in components/composer/: FromPicker (which account), SendButton (send or schedule),
// AttachedFiles, SecurityToggles (encrypt/sign) and pgpMail.ts (PGP, done here in the browser).
import { useQuery } from '@tanstack/react-query'
import { Maximize2, Minimize2, Paperclip, Send, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, del, fileToBase64, put } from '../lib/api'
import { htmlToText, quoteReply, withHtmlSignature, type BodyMode } from '../lib/compose'
import { formatFullDate } from '../lib/format'
import * as pgp from '../lib/pgp'
import { useAccounts, useMe, useRefreshMail } from '../lib/queries'
import { useStore } from '../lib/store'
import { BodyEditor } from './BodyEditor'
import { AttachedFiles } from './composer/AttachedFiles'
import { FromPicker } from './composer/FromPicker'
import { pgpText } from './composer/pgpMail'
import { SecurityToggles } from './composer/SecurityToggles'
import { SendButton } from './composer/SendButton'
import { RecipientField } from './RecipientField'
import { Input } from './ui'

// "a@x.com, b@y.com" → ["a@x.com", "b@y.com"]
const splitEmails = (value: string) =>
  value
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean)

// Where the composer sits on wider screens. On phones it always fills the screen.
const PLACEMENT = {
  normal: 'md:right-4 md:bottom-0 md:h-[min(600px,calc(100dvh-1rem))] md:w-[620px] md:rounded-t-2xl',
  max: 'md:inset-6 md:rounded-2xl',
  min: 'md:right-4 md:bottom-0 md:h-auto md:w-[360px] md:rounded-t-2xl', // just the title bar
}

export function Composer() {
  // `draft` is what the composer was opened with: empty for a new message, or a reply, forward or saved draft.
  const { draft, closeComposer, setHeldMessage } = useStore()
  const me = useMe().data
  const refresh = useRefreshMail()
  // Viewers of a shared account can read it but not send from it.
  const accounts = (useAccounts().data ?? []).filter((a) => a.role !== 'viewer')
  const smimeCerts = useQuery({ queryKey: ['smime'], queryFn: () => api<{ email: string }[]>('/smime') }).data ?? []
  const pgpKeys = useQuery({ queryKey: ['pgp-keys'], queryFn: () => api<pgp.StoredKey[]>('/pgp/keys') }).data ?? []

  const [draftId, setDraftId] = useState(draft?.id) // set once it has been saved as a draft
  const [to, setTo] = useState(splitEmails(draft?.to ?? ''))
  const [cc, setCc] = useState(splitEmails(draft?.cc ?? ''))
  const [bcc, setBcc] = useState(splitEmails(draft?.bcc ?? ''))
  const [showCopies, setShowCopies] = useState(cc.length + bcc.length > 0) // the Cc and Bcc fields
  const [subject, setSubject] = useState(draft?.subject ?? '')
  const [fromId, setFromId] = useState(draft?.accountId ?? draft?.replyTo?.accountId ?? '')
  const [files, setFiles] = useState<File[]>([])
  const [encrypt, setEncrypt] = useState(false)
  const [sign, setSign] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [size, setSize] = useState<keyof typeof PLACEMENT>('normal')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sentMessage, setSentMessage] = useState('') // "Message sent" etc., shown briefly before closing

  // The body. `version` goes up whenever the composer replaces the whole body (signature, quote),
  // which tells the editor to reload it; otherwise the editor keeps what the user is typing.
  const [mode, setMode] = useState<BodyMode>('rich')
  const [content, setContent] = useState('')
  const [version, setVersion] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)

  const account = accounts.find((a) => a.id === fromId) ?? accounts[0]
  const recipients = [...to, ...cc, ...bcc]
  const forwardedFiles = draft?.forwardOf ? (draft.replyTo?.attachments ?? []) : []
  const bccOnly = to.length === 0 && cc.length === 0 && bcc.length > 0
  // S/MIME when you have a certificate for this address; otherwise PGP.
  const method = account && smimeCerts.some((c) => c.email === account.email) ? 'S/MIME' : 'PGP'
  // Signing needs a key of your own, and so does reading your own encrypted copy in Sent.
  const hasKey = method === 'S/MIME' || pgpKeys.length > 0
  const needsPassphrase = method === 'PGP' && sign && !pgp.isUnlocked()

  function replaceContent(next: string) {
    setContent(next)
    setVersion((v) => v + 1)
  }

  // Fill in the body, only once, when the composer opens: a saved draft as it was, or (once we know
  // the account, and so its signature) a reply with the original quoted, or an empty message.
  useEffect(() => {
    if (version > 0) return
    if (draft?.html) return replaceContent(draft.html)
    if (!account) return
    if (!fromId) setFromId(account.id)
    const original = draft?.replyTo
    const start = original
      ? quoteReply(
          `On ${formatFullDate(original.date)}, ${original.from.name} wrote:`,
          original.text ?? original.preview,
        )
      : '<p><br></p>'
    replaceContent(withHtmlSignature(start, account.signature))
  }, [account?.id])

  // Switching accounts swaps in that account's signature.
  function changeAccount(accountId: string) {
    setFromId(accountId)
    const signature = accounts.find((a) => a.id === accountId)?.signature ?? ''
    replaceContent(withHtmlSignature(content, signature))
  }

  // What gets sent to the server: the message, its files, and how to protect it.
  async function buildPayload() {
    const attachments = await Promise.all(
      files.map(async (file) => ({
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        content: await fileToBase64(file),
      })),
    )
    const message = {
      accountId: account!.id,
      to,
      cc,
      bcc,
      subject,
      html: content as string | undefined,
      text: htmlToText(content),
      attachments,
      inReplyTo: draft?.replyTo?.messageId ?? undefined, // keeps the reply in the same conversation
      forwardOf: draft?.forwardOf,
    }
    if (!encrypt && !sign) return message
    if (method === 'S/MIME') return { ...message, smime: { encrypt, sign } } // the server does S/MIME

    // PGP mail is plain text, so the HTML version is dropped.
    const hasFiles = attachments.length > 0 || !!draft?.forwardOf
    const text = await pgpText({ text: message.text, recipients, encrypt, sign, passphrase, hasFiles })
    return { ...message, html: undefined, text }
  }

  async function send(scheduledFor?: Date) {
    if (!account) return setError('Add a mail account in Settings first.')
    if (recipients.length === 0) return setError('Add at least one recipient in To, Cc or Bcc.')
    setBusy(true)
    setError('')
    try {
      // Undo send: hold the message back for a few seconds (see SentNotice). Not for PGP mail, whose
      // text is already encrypted here and couldn't come back to the composer readable.
      const usesPgp = method === 'PGP' && (encrypt || sign)
      const undoSeconds = scheduledFor || usesPgp ? 0 : (me?.preferences.undoSendSeconds ?? 0)
      // draftId tells the server to delete the draft this message came from.
      const result = await api<{ id?: string; sendsAt?: string }>('/send', {
        body: { ...(await buildPayload()), scheduledFor: scheduledFor?.toISOString(), draftId, undoSeconds },
      })
      if (undoSeconds > 0 && result.id && result.sendsAt) {
        setHeldMessage({ id: result.id, accountId: account.id, subject, sendsAt: result.sendsAt })
        refresh()
        return closeComposer()
      }
      setSentMessage(scheduledFor ? `Scheduled for ${formatFullDate(scheduledFor.toISOString())}` : 'Message sent')
      refresh()
      setTimeout(closeComposer, 1200)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Closing keeps anything worth keeping as a draft.
  async function close() {
    const bodyText = htmlToText(withHtmlSignature(content, '')).trim() // the body without the signature
    const hasContent = recipients.length > 0 || subject.trim() !== '' || bodyText !== ''
    // Saved even with no mail account yet; it gets one when you pick a From address and send.
    if (hasContent && !sentMessage) {
      try {
        const saved = await put<{ id: string }>('/drafts', {
          id: draftId,
          accountId: account?.id,
          to,
          cc,
          bcc,
          subject,
          html: content,
          text: htmlToText(content),
          forwardOf: draft?.forwardOf,
        })
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

  return (
    <section
      aria-label="New message"
      className={`fixed inset-0 z-30 flex flex-col overflow-hidden border-line bg-panel shadow-pop md:inset-auto md:border ${PLACEMENT[size]}`}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') send() // ⌘↵ / Ctrl+Enter sends
      }}
    >
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <h2 className="truncate font-semibold">{subject || 'New message'}</h2>
        <div className="ml-auto flex items-center gap-0.5 text-muted">
          <button
            type="button"
            aria-label={size === 'min' ? 'Restore' : 'Minimize'}
            onClick={() => setSize(size === 'min' ? 'normal' : 'min')}
            className="hidden rounded-md p-1.5 hover:bg-raise md:block"
          >
            <Minimize2 size={15} />
          </button>
          <button
            type="button"
            aria-label={size === 'max' ? 'Restore' : 'Expand'}
            onClick={() => setSize(size === 'max' ? 'normal' : 'max')}
            className="hidden rounded-md p-1.5 hover:bg-raise md:block"
          >
            <Maximize2 size={15} />
          </button>
          <button
            type="button"
            aria-label="Close and keep draft"
            title="Close and keep draft"
            onClick={close}
            className="rounded-md p-1.5 hover:bg-raise"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {sentMessage && <SentConfirmation text={sentMessage} />}

      {!sentMessage && size !== 'min' && (
        <>
          <div className="flex items-center gap-2 border-b border-line px-4 py-2">
            <span className="w-9 text-[13px] text-muted">From</span>
            <FromPicker name={me?.name ?? ''} account={account} accounts={accounts} onChange={changeAccount} />
            {!showCopies && (
              <button
                type="button"
                onClick={() => setShowCopies(true)}
                className="ml-auto text-[13px] text-muted hover:text-ink"
              >
                Cc / Bcc
              </button>
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
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Subject"
            aria-label="Subject"
            className="border-b border-line bg-transparent px-4 py-2.5 font-semibold placeholder:font-normal placeholder:text-muted focus:outline-none"
          />

          <BodyEditor mode={mode} content={content} version={version} onChange={setContent} onModeChange={setMode} />

          {forwardedFiles.length > 0 && (
            <p className="px-4 pb-1 text-[12.5px] text-muted">
              <Paperclip size={12} className="mr-1 inline" />
              Forwarding {forwardedFiles.map((file) => file.filename).join(', ')}
            </p>
          )}
          <AttachedFiles files={files} onRemove={(file) => setFiles(files.filter((f) => f !== file))} />

          {needsPassphrase && (
            <div className="flex items-center gap-2 border-t border-line px-4 py-2">
              <span className="shrink-0 text-[13px] text-muted">PGP passphrase to sign</span>
              <Input
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                aria-label="PGP key passphrase"
                autoComplete="off"
              />
            </div>
          )}
          {(encrypt || sign) && method === 'PGP' && (
            <p className="px-4 pb-1 text-[12.5px] text-muted">
              PGP mail is sent as plain text; formatting and inline images are left out.
              {(me?.preferences.undoSendSeconds ?? 0) > 0 &&
                ' It’s encrypted here before it leaves, so it goes at once and can’t be unsent.'}
            </p>
          )}
          {error && (
            <p role="alert" className="px-4 pb-2 text-[13px] text-danger">
              {error}
            </p>
          )}

          <footer className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2.5">
            <SendButton busy={busy} onSend={send} />
            <button
              type="button"
              aria-label="Attach files"
              title="Attach files"
              onClick={() => fileInput.current?.click()}
              className="rounded-md p-1.5 text-muted hover:bg-raise hover:text-ink"
            >
              <Paperclip size={16} />
            </button>
            {/* The real file picker, hidden; the paperclip button above opens it. */}
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                setFiles([...files, ...Array.from(event.target.files ?? [])])
                event.target.value = '' // so picking the same file again still counts as a change
              }}
            />
            <SecurityToggles
              method={method}
              available={hasKey}
              encrypt={encrypt}
              sign={sign}
              onEncrypt={setEncrypt}
              onSign={setSign}
            />
            <button
              type="button"
              aria-label="Discard draft"
              title="Discard draft"
              onClick={discard}
              className="ml-auto rounded-md p-1.5 text-muted hover:bg-raise hover:text-danger"
            >
              <Trash2 size={16} />
            </button>
          </footer>
        </>
      )}
    </section>
  )
}

function SentConfirmation({ text }: { text: string }) {
  return (
    <div className="grid flex-1 place-items-center p-10 text-center">
      <div className="grid justify-items-center gap-2">
        <span className="accent-gradient grid h-12 w-12 place-items-center rounded-2xl text-accent-ink">
          <Send size={20} />
        </span>
        <p className="font-semibold">{text}</p>
      </div>
    </div>
  )
}
