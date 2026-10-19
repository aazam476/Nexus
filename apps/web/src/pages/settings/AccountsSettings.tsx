import { Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, Chip, Field, Input } from '../../components/ui'
import { accounts } from '../../mock/data'

const authLabels = { password: 'Password', 'oauth-google': 'Google sign-in', 'oauth-microsoft': 'Microsoft sign-in' }

export function AccountsSettings() {
  const [adding, setAdding] = useState(false)

  return (
    <>
      <Card
        title="Connected accounts"
        description="Every account appears in the unified inbox. Each has its own colour."
        actions={!adding && <Button variant="primary" onClick={() => setAdding(true)}><Plus size={15} /> Add account</Button>}
      >
        <ul className="divide-y divide-line">
          {accounts.map((account) => (
            <li key={account.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
              <i className="h-3 w-3 rounded-full" style={{ background: account.color }} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{account.email}</p>
                <p className="text-[12.5px] text-muted">{account.name} · {account.protocol.toUpperCase()} · {authLabels[account.auth]}</p>
              </div>
              {account.role !== 'owner' && <Chip color="var(--people)">Shared with you · {account.role}</Chip>}
              <Button variant="ghost" title="Sync now" aria-label={`Sync ${account.email} now`}><RefreshCw size={15} /></Button>
              <Button variant="secondary">Edit</Button>
            </li>
          ))}
        </ul>
      </Card>

      {adding && <AddAccount onDone={() => setAdding(false)} />}

      <Card title="Signatures" description="Added to the end of new messages. Formatting is kept in rich-text mail and turned into plain text otherwise.">
        <div className="grid gap-4">
          {accounts.map((account) => (
            <div key={account.id} className="grid gap-1.5">
              <span className="flex items-center gap-2 text-[12.5px] font-medium text-ink-2">
                <i className="h-2 w-2 rounded-full" style={{ background: account.color }} />
                {account.email}
              </span>
              {/* Signatures are the user's own HTML, edited in place; sanitised again on send. */}
              <div
                contentEditable
                role="textbox"
                aria-multiline="true"
                aria-label={`Signature for ${account.email}`}
                spellCheck
                className="min-h-16 rounded-lg border border-line bg-raise px-3 py-2 text-[13.5px] focus:border-accent focus:outline-none"
                dangerouslySetInnerHTML={{ __html: account.signature }}
              />
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}

function AddAccount({ onDone }: { onDone: () => void }) {
  const [method, setMethod] = useState<'google' | 'microsoft' | 'manual'>('manual')
  const [protocol, setProtocol] = useState<'imap' | 'pop3'>('imap')

  return (
    <Card title="Add an account" description="Use your provider’s sign-in where possible. It avoids storing your password.">
      <div className="grid gap-5">
        <div className="grid gap-2 sm:grid-cols-3">
          {([
            ['google', 'Google', 'OAuth2 sign-in'],
            ['microsoft', 'Microsoft', 'Outlook, Office 365'],
            ['manual', 'Other provider', 'IMAP / POP3 + SMTP'],
          ] as const).map(([id, name, detail]) => (
            <button
              key={id}
              type="button"
              aria-pressed={method === id}
              onClick={() => setMethod(id)}
              className={`rounded-xl border p-3 text-left ${method === id ? 'border-accent bg-sel' : 'border-line bg-raise hover:bg-hover'}`}
            >
              <p className="font-semibold">{name}</p>
              <p className="text-[12.5px] text-muted">{detail}</p>
            </button>
          ))}
        </div>

        {method !== 'manual' ? (
          <div className="flex items-center gap-3">
            <Button variant="primary">Continue with {method === 'google' ? 'Google' : 'Microsoft'}</Button>
            <Button variant="ghost" onClick={onDone}>Cancel</Button>
          </div>
        ) : (
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); onDone() }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email address"><Input type="email" placeholder="you@example.com" /></Field>
              <Field label="Display name"><Input placeholder="Ali Azam" /></Field>
            </div>
            <fieldset className="grid gap-3 rounded-xl border border-line p-4">
              <legend className="px-1 text-[12.5px] font-semibold text-ink-2">Incoming mail</legend>
              <div className="flex gap-2" role="radiogroup" aria-label="Protocol">
                {(['imap', 'pop3'] as const).map((p) => (
                  <button key={p} type="button" role="radio" aria-checked={protocol === p} onClick={() => setProtocol(p)}
                    className={`rounded-lg px-3 py-1.5 text-[13px] ${protocol === p ? 'bg-accent font-semibold text-accent-ink' : 'bg-raise text-ink-2'}`}>
                    {p.toUpperCase()}
                  </button>
                ))}
              </div>
              {protocol === 'pop3' && <p className="text-[12.5px] text-muted">POP3 downloads mail into Nexus. Folders, read state and stars stay in Nexus only and won’t sync to other apps.</p>}
              <div className="grid gap-3 sm:grid-cols-[1fr_100px_140px]">
                <Field label="Server"><Input placeholder={protocol === 'imap' ? 'imap.example.com' : 'pop.example.com'} /></Field>
                <Field label="Port"><Input inputMode="numeric" defaultValue={protocol === 'imap' ? '993' : '995'} /></Field>
                <Field label="Security">
                  <select className="w-full rounded-lg border border-line bg-raise px-3 py-2 text-ink"><option>SSL/TLS</option><option>STARTTLS</option></select>
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Username"><Input autoComplete="off" /></Field>
                <Field label="Password" hint="Stored encrypted. An app password is safer than your main one."><Input type="password" autoComplete="new-password" /></Field>
              </div>
            </fieldset>
            <fieldset className="grid gap-3 rounded-xl border border-line p-4">
              <legend className="px-1 text-[12.5px] font-semibold text-ink-2">Outgoing mail (SMTP)</legend>
              <div className="grid gap-3 sm:grid-cols-[1fr_100px_140px]">
                <Field label="Server"><Input placeholder="smtp.example.com" /></Field>
                <Field label="Port"><Input inputMode="numeric" defaultValue="465" /></Field>
                <Field label="Security">
                  <select className="w-full rounded-lg border border-line bg-raise px-3 py-2 text-ink"><option>SSL/TLS</option><option>STARTTLS</option></select>
                </Field>
              </div>
              <label className="flex items-center gap-2 text-[13px] text-ink-2"><input type="checkbox" defaultChecked className="accent-[var(--accent)]" /> Same username and password as incoming</label>
            </fieldset>
            <div className="flex gap-2">
              <Button type="submit" variant="primary">Test and add account</Button>
              <Button variant="ghost" onClick={onDone}>Cancel</Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  )
}
