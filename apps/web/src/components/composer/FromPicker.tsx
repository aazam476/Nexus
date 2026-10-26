// The "From" line: which of your accounts the message is sent from.
import { ChevronDown } from 'lucide-react'
import type { Account } from '../../types'

interface Props {
  name: string // your name, shown before each address
  account: Account | undefined // the one chosen now
  accounts: Account[] // the ones you may send from
  onChange: (accountId: string) => void
}

export function FromPicker({ name, account, accounts, onChange }: Props) {
  if (!account) return <span className="text-muted">No account to send from yet</span>
  return (
    // A real <select> keeps it usable with a keyboard and screen readers. It is invisible and laid
    // over the visible text, so the arrow sits right after the chosen address (a plain select would
    // be as wide as its longest address).
    <label className="relative flex min-w-0 items-center gap-1 rounded-md px-1 text-ink focus-within:ring-2 focus-within:ring-accent hover:bg-raise">
      <span className="truncate">
        {name} &lt;{account.email}&gt;
      </span>
      <ChevronDown size={14} className="shrink-0 text-muted" />
      <select
        value={account.id}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Send from"
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {name} &lt;{a.email}&gt;
          </option>
        ))}
      </select>
    </label>
  )
}
