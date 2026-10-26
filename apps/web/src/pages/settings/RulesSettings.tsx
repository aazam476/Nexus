// Settings → Rules & spam: rules that sort new mail, and blocked senders.
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Button, Card, Field, Input, Toggle } from '../../components/ui'
import { api, del, patch, put } from '../../lib/api'
import { useBlocked, useMe, useRules } from '../../lib/queries'
import type { Rule } from '../../types'

const actions: Record<Rule['action'], { text: string; needsValue?: string }> = {
  label: { text: 'add label', needsValue: 'Label name' },
  move: { text: 'move to', needsValue: 'Folder' },
  category: { text: 'put in', needsValue: 'Section' },
  'mark-read': { text: 'mark as read' },
  spam: { text: 'send to spam' },
}

export function RulesSettings() {
  const client = useQueryClient()
  const rules = useRules().data ?? []
  const blocked = useBlocked().data ?? []
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const refresh = (key: string) => client.invalidateQueries({ queryKey: [key] })

  async function block(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    try {
      await api('/blocked', { body: { pattern: new FormData(form).get('pattern') } })
      form.reset()
      setError('')
      refresh('blocked')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <>
      <Card title="Rules" description="Run on new mail as it arrives, top to bottom." actions={!adding && <Button variant="primary" onClick={() => setAdding(true)}><Plus size={15} /> New rule</Button>}>
        <div className="grid gap-2">
          {adding && <NewRule onDone={() => { setAdding(false); refresh('rules'); refresh('labels') }} />}
          {rules.length === 0 && !adding && <p className="text-muted">No rules yet. Rules can label, move, mark as read or send mail to spam.</p>}
          <ul className="grid gap-2">
            {rules.map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-raise px-4 py-3">
                <Toggle checked={rule.enabled} label={`Enable ${rule.name}`} onChange={(enabled) => patch(`/rules/${rule.id}`, { enabled }).then(() => refresh('rules'))} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{rule.name}</p>
                  <p className="text-[12.5px] text-muted">
                    If <b className="text-ink-2">{rule.field}</b> contains “{rule.contains}”, {actions[rule.action].text} {rule.value && <b className="text-ink-2">{rule.value}</b>}
                  </p>
                </div>
                <Button variant="ghost" aria-label={`Delete ${rule.name}`} onClick={() => del(`/rules/${rule.id}`).then(() => refresh('rules'))}><Trash2 size={15} /></Button>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <Card title="Spam" description="Nexus reads your mail server’s spam score and learns from “Mark as spam”.">
        <div className="grid gap-5">
          <SpamThreshold />
          <div className="grid gap-2">
            <span className="text-[13px] font-medium text-ink-2">Blocked senders and domains</span>
            {blocked.length === 0 && <p className="text-[13px] text-muted">Nobody yet. “Mark as spam” adds the sender here.</p>}
            <ul className="flex flex-wrap gap-2">
              {blocked.map((sender) => (
                <li key={sender} className="flex items-center gap-1 rounded-full bg-raise py-1 pr-1.5 pl-3 text-[13px]">
                  {sender}
                  <button type="button" aria-label={`Unblock ${sender}`} onClick={() => del(`/blocked/${encodeURIComponent(sender)}`).then(() => refresh('blocked'))} className="rounded-full p-0.5 text-muted hover:text-ink"><X size={13} /></button>
                </li>
              ))}
            </ul>
            <form className="flex max-w-sm gap-2" onSubmit={block}>
              <Input name="pattern" placeholder="spam@example.com or example.com" aria-label="Sender or domain to block" required />
              <Button type="submit">Block</Button>
            </form>
            {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
          </div>
        </div>
      </Card>
    </>
  )
}

function SpamThreshold() {
  const me = useMe().data
  const client = useQueryClient()
  const [level, setLevel] = useState(me?.preferences.spamThreshold ?? 5)
  useEffect(() => { if (me) setLevel(me.preferences.spamThreshold) }, [me])
  const save = () => put('/auth/me/preferences', { spamThreshold: level }).then(() => client.invalidateQueries({ queryKey: ['me'] }))
  return (
    <label className="grid gap-2">
      <span className="flex justify-between text-[13px]"><span className="font-medium text-ink-2">Filter strength</span><span className="text-muted">Spam when score ≥ {level}</span></span>
      <input type="range" min={1} max={15} step={0.5} value={level} onChange={(e) => setLevel(Number(e.target.value))} onPointerUp={save} onKeyUp={save} className="accent-[var(--accent)]" />
      <span className="flex justify-between text-[12px] text-muted"><span>Catch more</span><span>Fewer false alarms</span></span>
    </label>
  )
}

function NewRule({ onDone }: { onDone: () => void }) {
  const [action, setAction] = useState<Rule['action']>('label')
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>
    try {
      await api('/rules', { body: { name: form.name, field: form.field, contains: form.contains, action, value: form.value || null } })
      onDone()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const select = 'w-full rounded-lg border border-line bg-raise px-3 py-2 text-ink'
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-2">
      <div className="sm:col-span-2"><Field label="Rule name"><Input name="name" placeholder="Invoices to Receipts" required autoFocus /></Field></div>
      <Field label="When">
        <select name="field" className={select}><option value="from">Sender</option><option value="to">Recipient</option><option value="subject">Subject</option><option value="body">Message text</option></select>
      </Field>
      <Field label="Contains"><Input name="contains" placeholder="invoice" required /></Field>
      <Field label="Then">
        <select value={action} onChange={(e) => setAction(e.target.value as Rule['action'])} className={select}>
          {Object.entries(actions).map(([id, a]) => <option key={id} value={id}>{a.text[0].toUpperCase() + a.text.slice(1)}</option>)}
        </select>
      </Field>
      {action === 'move' ? (
        <Field label="Folder"><select name="value" className={select}><option value="archive">Archive</option><option value="spam">Spam</option><option value="trash">Trash</option></select></Field>
      ) : action === 'category' ? (
        <Field label="Section"><select name="value" className={select}><option value="people">People</option><option value="travel">Travel</option><option value="notifications">Notifications</option><option value="newsletters">Newsletters</option></select></Field>
      ) : actions[action].needsValue ? (
        <Field label={actions[action].needsValue!}><Input name="value" required /></Field>
      ) : <span />}
      {error && <p role="alert" className="text-[13px] text-danger sm:col-span-2">{error}</p>}
      <div className="flex gap-2 sm:col-span-2"><Button type="submit" variant="primary">Save rule</Button><Button onClick={onDone}>Cancel</Button></div>
    </form>
  )
}
