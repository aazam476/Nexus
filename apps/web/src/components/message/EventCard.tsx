// A calendar card for a flight, hotel stay or event found in the email (see server/features/mail/events.ts),
// with buttons to download it as .ics or add it to a calendar plugin.
import { CalendarPlus, Check, Download } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../lib/api'
import { formatFullDate } from '../../lib/format'
import { usePlugins } from '../../lib/queries'
import type { CalendarEvent } from '../../types'
import { Button } from '../ui'

export function EventCard({ messageId, event }: { messageId: string; event: CalendarEvent }) {
  const [busy, setBusy] = useState(false)
  const [addedTo, setAddedTo] = useState('') // the calendar it was added to, once done
  const [error, setError] = useState('')
  // Every turned-on plugin that can create calendar events (e.g. Nextcloud Calendar).
  const calendars = (usePlugins().data ?? []).filter((p) => p.enabled && p.capabilities.includes('create-event'))
  const start = new Date(event.start)

  async function addTo(pluginId: string, name: string) {
    setBusy(true)
    setError('')
    try {
      await api(`/plugins/${pluginId}/create-event`, { body: { messageId } })
      setAddedTo(name)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-2 rounded-2xl border border-[color-mix(in_srgb,var(--travel)_30%,transparent)] bg-[color-mix(in_srgb,var(--travel)_10%,transparent)] p-4">
      <div className="flex flex-wrap items-center gap-4">
        {/* A little tear-off calendar page: month on top, day below. */}
        <div className="w-12 overflow-hidden rounded-[10px] bg-ground text-center">
          <b className="block bg-travel py-0.5 text-[11px] tracking-wider text-[#0e0f12]">
            {start.toLocaleString([], { month: 'short' }).toUpperCase()}
          </b>
          <span className="block py-1 text-[19px] font-bold">{start.getDate()}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{event.title}</p>
          <p className="text-[13px] text-muted">
            {formatFullDate(event.start)}
            {event.location && ` · ${event.location}`}
          </p>
          {event.detail && <p className="text-[13px] text-muted">{event.detail}</p>}
        </div>
        <div className="flex gap-2">
          <a
            href={`/api/messages/${messageId}/event.ics`}
            className="rounded-lg p-2 text-ink-2 hover:bg-raise"
            title="Download .ics"
            aria-label="Download calendar file"
          >
            <Download size={15} />
          </a>
          {calendars.map((plugin) => {
            const added = addedTo === plugin.name
            return (
              <Button
                key={plugin.id}
                variant="primary"
                onClick={() => addTo(plugin.id, plugin.name)}
                disabled={busy || addedTo !== ''}
              >
                {added ? <Check size={15} /> : <CalendarPlus size={15} />}
                {added ? `Added to ${plugin.name}` : `Add to ${plugin.name}`}
              </Button>
            )
          })}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
