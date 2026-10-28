// The small "Message sent" notice in the bottom right, after a message is sent with undo send on.
// While the message is held back, Undo send brings it back to the composer, and View message or
// closing the notice sends it right away. Once the time is up the server sends it, and the notice
// stays (without Undo send) until it's closed.
import { Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '../lib/api'
import { useRefreshMail } from '../lib/queries'
import { useStore, type HeldMessage } from '../lib/store'
import type { Message } from '../types'

export function SentNotice() {
  const { heldMessage, setHeldMessage } = useStore()
  if (!heldMessage) return null
  // `key`: a second message sent while the first notice shows starts a fresh notice.
  return <Notice key={heldMessage.id} held={heldMessage} onDone={() => setHeldMessage(null)} />
}

function Notice({ held, onDone }: { held: HeldMessage; onDone: () => void }) {
  const { openComposer } = useStore()
  const navigate = useNavigate()
  const refreshMail = useRefreshMail()
  const [error, setError] = useState('')
  const [undoable, setUndoable] = useState(true)

  // The server sends it when the time is up; then there's nothing left to undo.
  useEffect(() => {
    const timer = setTimeout(() => setUndoable(false), Date.parse(held.sendsAt) - Date.now())
    return () => clearTimeout(timer)
  }, [held])

  // Asks the server to stop waiting. If it's already on its way (or gone), that's fine too.
  const sendNow = async () => {
    if (undoable) await api(`/outgoing/${held.id}/send-now`, { body: {} }).catch(() => undefined)
  }

  async function undo() {
    try {
      const draft = await api<{
        id: string
        accountId: string
        to: string[]
        cc: string[]
        bcc: string[]
        subject: string
        html?: string
      }>(`/outgoing/${held.id}/undo`, { body: {} })
      onDone()
      openComposer({ ...draft, to: draft.to.join(', '), cc: draft.cc.join(', '), bcc: draft.bcc.join(', ') })
    } catch (e) {
      setError((e as Error).message) // "Too late": it went out just now
      setUndoable(false)
    }
  }

  // Sends it, then opens the copy in Sent once the mail server has it.
  async function view() {
    onDone()
    await sendNow()
    navigate('/mail/sent')
    await api(`/accounts/${held.accountId}/sync`, { body: {} })
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      const sent = await api<Message[]>('/messages?folder=sent')
      const copy = sent.find((m) => m.subject === held.subject) // newest first
      if (copy) {
        refreshMail() // so the list shows the copy too
        return navigate(`/mail/sent/${copy.id}`)
      }
    }
    refreshMail()
  }

  function dismiss() {
    onDone()
    sendNow()
  }

  return (
    <div
      role="status"
      className="fixed right-4 bottom-4 z-40 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-xl border border-line bg-panel py-2.5 pr-2.5 pl-3.5 text-[13px] shadow-pop"
    >
      <Check size={15} className="shrink-0 text-news" />
      {error ? (
        <span className="text-danger">{error}</span>
      ) : (
        <>
          <span className="font-medium">Message sent.</span>
          <button type="button" onClick={view} className="font-semibold text-accent-text hover:underline">
            View message
          </button>
          {undoable && (
            <button type="button" onClick={undo} className="font-semibold text-accent-text hover:underline">
              Undo send
            </button>
          )}
        </>
      )}
      <button
        type="button"
        aria-label="Close"
        onClick={dismiss}
        className="rounded-md p-1 text-muted hover:bg-raise hover:text-ink"
      >
        <X size={14} />
      </button>
    </div>
  )
}
