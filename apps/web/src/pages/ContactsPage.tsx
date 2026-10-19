import { ArrowLeft, Download, KeyRound, Mail, Menu, Plus, Search, Upload } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router'
import type { ShellContext } from '../components/AppShell'
import { Avatar, Button, Chip } from '../components/ui'
import { contacts } from '../mock/data'
import { useStore } from '../lib/store'

export function ContactsPage() {
  const { contactId } = useParams()
  const navigate = useNavigate()
  const { openNav } = useOutletContext<ShellContext>()
  const { openComposer } = useStore()
  const [query, setQuery] = useState('')

  const visible = contacts
    .filter((c) => `${c.name} ${c.emails.join(' ')} ${c.company ?? ''}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
  const selected = contacts.find((c) => c.id === contactId)

  return (
    <div className="flex h-full">
      <section aria-label="Contacts" className={`h-full flex-col border-r border-line bg-panel md:flex md:w-[360px] md:shrink-0 ${selected ? 'hidden' : 'flex w-full'}`}>
        <header className="grid gap-2.5 px-3.5 pt-3.5 pb-2">
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Open menu" onClick={openNav} className="-ml-1 rounded-md p-1 text-muted hover:bg-raise md:hidden"><Menu size={18} /></button>
            <h1 className="text-[19px] font-bold tracking-tight">Contacts</h1>
            <div className="ml-auto flex gap-1">
              <Button variant="ghost" title="Import vCard" aria-label="Import vCard"><Upload size={15} /></Button>
              <Button variant="ghost" title="Export vCard" aria-label="Export vCard"><Download size={15} /></Button>
              <Button variant="secondary"><Plus size={15} /> New</Button>
            </div>
          </div>
          <label className="flex items-center gap-2 rounded-[9px] border border-line bg-raise px-2.5 py-1.5 text-muted focus-within:border-accent">
            <Search size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search contacts" aria-label="Search contacts" className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-muted focus:outline-none" />
          </label>
        </header>
        <ul className="flex-1 overflow-y-auto px-1.5 pb-4">
          {visible.map((contact) => (
            <li key={contact.id}>
              <Link
                to={`/contacts/${contact.id}`}
                aria-current={contact.id === contactId ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-[10px] px-2.5 py-2 ${contact.id === contactId ? 'bg-sel ring-1 ring-sel-line' : 'hover:bg-hover'}`}
              >
                <Avatar name={contact.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{contact.name}</span>
                  <span className="block truncate text-[12.5px] text-muted">{contact.emails[0]}</span>
                </span>
                {contact.pgpKey && <KeyRound size={14} className="text-news" aria-label="Has PGP key" />}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className={`h-full min-w-0 flex-1 overflow-y-auto bg-read ${selected ? '' : 'hidden md:block'}`}>
        {selected ? (
          <div className="mx-auto grid max-w-[640px] gap-6 px-5 py-8 md:px-10">
            <button type="button" onClick={() => navigate('/contacts')} className="flex items-center gap-1.5 text-muted md:hidden"><ArrowLeft size={16} /> Contacts</button>
            <div className="flex items-center gap-4">
              <Avatar name={selected.name} size={64} />
              <div>
                <h2 className="text-[23px] font-bold tracking-tight">{selected.name}</h2>
                {selected.company && <p className="text-muted">{selected.company}</p>}
              </div>
              <Button variant="primary" className="ml-auto" onClick={() => openComposer({ to: selected.emails[0] })}><Mail size={15} /> Email</Button>
            </div>
            <dl className="grid gap-4 rounded-2xl border border-line bg-panel p-5">
              <div><dt className="text-[12px] font-semibold text-muted">Email</dt>{selected.emails.map((e) => <dd key={e}>{e}</dd>)}</div>
              {selected.phone && <div><dt className="text-[12px] font-semibold text-muted">Phone</dt><dd>{selected.phone}</dd></div>}
              <div><dt className="text-[12px] font-semibold text-muted">Messages</dt><dd>{selected.messageCount} exchanged</dd></div>
            </dl>
            <div className="grid gap-3 rounded-2xl border border-line bg-panel p-5">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">PGP public key</h3>
                {selected.pgpKey ? <Chip color="var(--news)">Mail to them can be encrypted</Chip> : <Chip color="var(--muted)">No key</Chip>}
              </div>
              {selected.pgpKey ? (
                <>
                  <code className="rounded-lg bg-raise px-3 py-2 font-mono text-[12.5px] break-all text-ink-2">{selected.pgpKey.fingerprint}</code>
                  <p className="text-[12.5px] text-muted">Created {selected.pgpKey.created}. Compare this fingerprint with {selected.name.split(' ')[0]} in person before trusting it.</p>
                </>
              ) : (
                <div className="flex gap-2">
                  <Button variant="secondary"><Upload size={15} /> Import key</Button>
                  <Button variant="ghost">Look up on keys.openpgp.org</Button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="grid h-full place-items-center text-muted">Pick a contact</div>
        )}
      </section>
    </div>
  )
}
