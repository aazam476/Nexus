// The Send button, with an arrow beside it that opens "Schedule send": a few common times, or any
// date and time you pick.
import { ChevronDown, Clock, Send } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../ui'

// Tomorrow at 8:00, tomorrow at 13:00, and next Monday at 8:00 (in your own time zone).
function scheduleOptions() {
  const at = (daysFromNow: number, hour: number) => {
    const date = new Date()
    date.setDate(date.getDate() + daysFromNow)
    date.setHours(hour, 0, 0, 0)
    return date
  }
  // getDay() is 0 for Sunday … 6 for Saturday. Days until next Monday: 1 from Sunday, 7 from Monday itself.
  const daysToMonday = (8 - new Date().getDay()) % 7 || 7
  return [
    { label: 'Tomorrow morning', date: at(1, 8) },
    { label: 'Tomorrow afternoon', date: at(1, 13) },
    { label: 'Monday morning', date: at(daysToMonday, 8) },
  ]
}

// onSend() sends now; onSend(date) schedules it.
export function SendButton({ busy, onSend }: { busy: boolean; onSend: (scheduledFor?: Date) => void }) {
  const [menuOpen, setMenuOpen] = useState(false)

  function choose(date?: Date) {
    setMenuOpen(false)
    onSend(date)
  }

  return (
    <div className="relative flex">
      <Button variant="primary" className="rounded-r-none" onClick={() => choose()} disabled={busy} title="Send (⌘↵)">
        <Send size={15} /> {busy ? 'Sending…' : 'Send'}
      </Button>
      <Button
        variant="primary"
        className="rounded-l-none border-l border-black/15 px-2"
        aria-label="Schedule send"
        aria-expanded={menuOpen}
        disabled={busy}
        onClick={() => setMenuOpen(!menuOpen)}
      >
        <ChevronDown size={15} />
      </Button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-10 mb-2 w-64 rounded-xl border border-line bg-panel p-1 shadow-pop"
        >
          <p className="px-2.5 pt-1.5 pb-1 text-[12px] font-semibold text-muted">Schedule send</p>
          {scheduleOptions().map(({ label, date }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              onClick={() => choose(date)}
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left hover:bg-raise"
            >
              {label}
              <span className="text-[12px] text-muted">
                {date.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            </button>
          ))}
          <form
            className="flex items-center gap-2 rounded-lg px-2.5 py-2"
            onSubmit={(event) => {
              event.preventDefault()
              const picked = new FormData(event.currentTarget).get('at') // e.g. "2030-05-01T09:30"
              if (picked) choose(new Date(String(picked)))
            }}
          >
            <Clock size={14} className="shrink-0 text-muted" />
            <input
              name="at"
              type="datetime-local"
              required
              aria-label="Pick date and time"
              className="min-w-0 flex-1 bg-transparent text-ink focus:outline-none"
            />
            <Button type="submit" variant="ghost" className="px-2">
              Set
            </Button>
          </form>
        </div>
      )}
    </div>
  )
}
