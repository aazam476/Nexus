import { KeyRound, X } from 'lucide-react'
import { useEffect, useState, type KeyboardEvent } from 'react'
import { useContacts } from '../lib/queries'

const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

// A "To/Cc/Bcc" line: typed addresses become chips, with contact suggestions.
export function RecipientField({ label, value, onChange, autoFocus }: {
  label: string
  value: string[]
  onChange: (emails: string[]) => void
  autoFocus?: boolean
}) {
  const [text, setText] = useState('')
  const [search, setSearch] = useState('')
  const [active, setActive] = useState(0)
  // Ask the server once typing pauses; contacts are ranked by how often you write to them.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), 150)
    return () => clearTimeout(timer)
  }, [text])
  const contacts = useContacts(search).data ?? []

  const suggestions = search
    ? contacts
        .flatMap((c) => c.emails.map((email) => ({ name: c.name, email, hasKey: !!c.pgpPublicKey })))
        .filter((s) => !value.includes(s.email) && `${s.name} ${s.email}`.toLowerCase().includes(search.toLowerCase()))
        .slice(0, 5)
    : []

  function add(email: string) {
    const clean = email.trim().replace(/,$/, '')
    if (clean && !value.includes(clean)) onChange([...value, clean])
    setText('')
    setActive(0)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => Math.min(i + 1, suggestions.length - 1)) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    if (event.key === 'Enter' || event.key === ',' || event.key === 'Tab') {
      if (suggestions[active]) { event.preventDefault(); add(suggestions[active].email) }
      else if (text.trim()) { event.preventDefault(); add(text) }
    }
    if (event.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
  }

  return (
    <div className="relative flex min-h-10 flex-wrap items-center gap-1.5 border-b border-line px-4 py-1.5">
      <span className="w-9 shrink-0 text-[13px] text-muted">{label}</span>
      {value.map((email) => (
        <span
          key={email}
          className={`flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-[13px] ${looksLikeEmail(email) ? 'bg-raise text-ink' : 'bg-[color-mix(in_srgb,var(--danger)_15%,transparent)] text-danger'}`}
          title={looksLikeEmail(email) ? email : 'This does not look like an email address'}
        >
          {email}
          <button type="button" aria-label={`Remove ${email}`} onClick={() => onChange(value.filter((e) => e !== email))} className="rounded-full p-0.5 text-muted hover:text-ink">
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => text.trim() && add(text)}
        aria-label={label}
        autoFocus={autoFocus}
        className="min-w-32 flex-1 bg-transparent py-1 text-ink focus:outline-none"
      />
      {suggestions.length > 0 && (
        <ul role="listbox" className="absolute top-full left-12 z-10 mt-1 w-72 rounded-xl border border-line bg-panel p-1 shadow-pop">
          {suggestions.map((s, i) => (
            <li key={s.email} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); add(s.email) }}
                className={`flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left ${i === active ? 'bg-raise' : ''}`}
              >
                <span className="flex items-center gap-1.5">{s.name}{s.hasKey && <KeyRound size={11} className="text-news" aria-label="Has PGP key" />}</span>
                <span className="text-[12px] text-muted">{s.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
