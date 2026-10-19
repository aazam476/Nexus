import { Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, Input, Toggle } from '../../components/ui'
import { blockedSenders, rules as initialRules } from '../../mock/data'

const actionText = { label: 'add label', move: 'move to', category: 'put in', 'mark-read': 'mark as read', spam: 'send to spam' }

export function RulesSettings() {
  const [rules, setRules] = useState(initialRules)
  const [blocked, setBlocked] = useState(blockedSenders)
  const [spamLevel, setSpamLevel] = useState(5)

  return (
    <>
      <Card title="Rules" description="Run on new mail, top to bottom." actions={<Button variant="primary"><Plus size={15} /> New rule</Button>}>
        <ul className="grid gap-2">
          {rules.map((rule) => (
            <li key={rule.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-raise px-4 py-3">
              <Toggle checked={rule.enabled} label={`Enable ${rule.name}`} onChange={(enabled) => setRules(rules.map((r) => (r.id === rule.id ? { ...r, enabled } : r)))} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{rule.name}</p>
                <p className="text-[12.5px] text-muted">
                  If <b className="text-ink-2">{rule.when.field}</b> contains “{rule.when.contains}”, {actionText[rule.then.action]} {rule.then.value && <b className="text-ink-2">{rule.then.value}</b>}
                </p>
              </div>
              <Button variant="ghost" aria-label={`Delete ${rule.name}`} onClick={() => setRules(rules.filter((r) => r.id !== rule.id))}><Trash2 size={15} /></Button>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Spam" description="Nexus reads your mail server’s spam score and learns from “Mark as spam”.">
        <div className="grid gap-5">
          <label className="grid gap-2">
            <span className="flex justify-between text-[13px]"><span className="font-medium text-ink-2">Filter strength</span><span className="text-muted">Score ≥ {spamLevel}</span></span>
            <input type="range" min={1} max={10} value={spamLevel} onChange={(e) => setSpamLevel(Number(e.target.value))} className="accent-[var(--accent)]" />
            <span className="flex justify-between text-[12px] text-muted"><span>Catch more</span><span>Fewer false alarms</span></span>
          </label>
          <div className="grid gap-2">
            <span className="text-[13px] font-medium text-ink-2">Blocked senders and domains</span>
            <ul className="flex flex-wrap gap-2">
              {blocked.map((sender) => (
                <li key={sender} className="flex items-center gap-1 rounded-full bg-raise py-1 pr-1.5 pl-3 text-[13px]">
                  {sender}
                  <button type="button" aria-label={`Unblock ${sender}`} onClick={() => setBlocked(blocked.filter((b) => b !== sender))} className="rounded-full p-0.5 text-muted hover:text-ink"><X size={13} /></button>
                </li>
              ))}
            </ul>
            <form className="flex max-w-sm gap-2" onSubmit={(e) => {
              e.preventDefault()
              const value = new FormData(e.currentTarget).get('sender')?.toString().trim()
              if (value) setBlocked([...blocked, value])
              e.currentTarget.reset()
            }}>
              <Input name="sender" placeholder="spam@example.com or example.com" aria-label="Sender or domain to block" />
              <Button type="submit">Block</Button>
            </form>
          </div>
        </div>
      </Card>
    </>
  )
}
