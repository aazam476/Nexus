// Shown above a scheduled message: when it will go out (or why sending failed), with Send now and Cancel.
import { useState } from 'react'
import { api } from '../../lib/api'
import { formatFullDate } from '../../lib/format'
import type { Message } from '../../types'
import { Button } from '../ui'

export function ScheduledBar({ message, onDone }: { message: Message; onDone: () => void }) {
  const [error, setError] = useState('')

  async function run(request: () => Promise<unknown>) {
    try {
      await request()
      onDone()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const sendNow = () => run(() => api(`/outgoing/${message.id}/send-now`, { body: {} }))
  const cancel = () => run(() => api(`/outgoing/${message.id}`, { method: 'DELETE' }))

  return (
    <div className="grid gap-2 rounded-xl border border-line bg-raise px-4 py-3">
      <div className="flex flex-wrap items-center gap-3 text-ink-2">
        {message.error ? (
          <span className="text-danger">Sending failed: {message.error}</span>
        ) : (
          <>Scheduled to send {formatFullDate(message.scheduledFor!)}</>
        )}
        <Button variant="ghost" className="ml-auto" onClick={sendNow}>
          Send now
        </Button>
        <Button variant="danger" onClick={cancel}>
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
