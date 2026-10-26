// The address book: list and search contacts, add or edit one, vCard import/export, and PGP keys per contact.
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Download, KeyRound, Mail, Menu, Plus, Search, Trash2, Upload } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router'
import type { ShellContext } from '../components/AppShell'
import { Avatar, Button, Chip, Field, Input } from '../components/ui'
import { api, del, patch } from '../lib/api'
import * as pgp from '../lib/pgp'
import { useContacts } from '../lib/queries'
import { useStore } from '../lib/store'
import type { Contact } from '../types'

export function ContactsPage() {
  const { contactId } = useParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const { openNav } = useOutletContext<ShellContext>()
  const contacts = useContacts().data ?? []
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')
  const importInput = useRef<HTMLInputElement>(null)
  const refresh = () => client.invalidateQueries({ queryKey: ['contacts'] })

  const visible = contacts
    .filter((c) => `${c.name} ${c.emails.join(' ')} ${c.company ?? ''}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
  const selected = contacts.find((c) => c.id === contactId)
  const creating = contactId === 'new'

  async function importVcf(file: File) {
    try {
      const result = await api<{ added: number }>('/contacts/import', { body: { vcf: await file.text() } })
      setNotice(`Imported ${result.added} new contact${result.added === 1 ? '' : 's'}`)
      refresh()
    } catch (e) {
      setNotice((e as Error).message)
    }
  }

  return (
    <div className="flex h-full">
      <section aria-label="Contacts" className={`h-full flex-col border-r border-line bg-panel lg:flex lg:w-[320px] lg:shrink-0 xl:w-[360px] ${selected || creating ? 'hidden' : 'flex w-full'}`}>
        <header className="grid gap-2.5 px-3.5 pt-3.5 pb-2">
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Open menu" onClick={openNav} className="-ml-1 rounded-md p-1 text-muted hover:bg-raise md:hidden"><Menu size={18} /></button>
            <h1 className="text-[19px] font-bold tracking-tight">Contacts</h1>
            <div className="ml-auto flex gap-1">
              <Button variant="ghost" title="Import vCard" aria-label="Import vCard" onClick={() => importInput.current?.click()}><Upload size={15} /></Button>
              <input ref={importInput} type="file" accept=".vcf,text/vcard" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importVcf(f); e.target.value = '' }} />
              <a href="/api/contacts/export.vcf" title="Export vCard" aria-label="Export vCard" className="rounded-lg px-3 py-1.5 text-ink-2 hover:bg-raise"><Download size={15} /></a>
              <Button variant="secondary" onClick={() => navigate('/contacts/new')}><Plus size={15} /> New</Button>
            </div>
          </div>
          <label className="flex items-center gap-2 rounded-[9px] border border-line bg-raise px-2.5 py-1.5 text-muted focus-within:border-accent">
            <Search size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search contacts" aria-label="Search contacts" className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-muted focus:outline-none" />
          </label>
          {notice && <p role="status" className="text-[12.5px] text-muted">{notice}</p>}
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
                {contact.pgpPublicKey && <KeyRound size={14} className="text-news" aria-label="Has PGP key" />}
              </Link>
            </li>
          ))}
          {visible.length === 0 && <li className="px-4 py-10 text-center text-muted">{query ? 'No contacts match.' : 'People you write to are added here automatically.'}</li>}
        </ul>
      </section>

      <section className={`h-full min-w-0 flex-1 overflow-y-auto bg-read ${selected || creating ? '' : 'hidden lg:block'}`}>
        {creating ? (
          <ContactForm onDone={(id) => { refresh(); navigate(id ? `/contacts/${id}` : '/contacts') }} />
        ) : selected ? (
          <ContactDetail key={selected.id} contact={selected} onChange={refresh} onDeleted={() => { refresh(); navigate('/contacts') }} />
        ) : (
          <div className="grid h-full place-items-center text-muted">Pick a contact</div>
        )}
      </section>
    </div>
  )
}

function ContactForm({ onDone }: { onDone: (id?: string) => void }) {
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>
    try {
      const contact = await api<Contact>('/contacts', {
        body: { name: form.name, emails: form.emails.split(/[,\s]+/).filter(Boolean), phone: form.phone || undefined, company: form.company || undefined },
      })
      onDone(contact.id)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <form onSubmit={submit} className="mx-auto grid max-w-[520px] gap-4 px-5 py-8">
      <h2 className="text-[23px] font-bold tracking-tight">New contact</h2>
      <Field label="Name"><Input name="name" required autoFocus /></Field>
      <Field label="Email" hint="Separate several addresses with commas."><Input name="emails" required /></Field>
      <Field label="Phone"><Input name="phone" type="tel" /></Field>
      <Field label="Company"><Input name="company" /></Field>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex gap-2"><Button type="submit" variant="primary">Save contact</Button><Button onClick={() => onDone()}>Cancel</Button></div>
    </form>
  )
}

function ContactDetail({ contact, onChange, onDeleted }: { contact: Contact; onChange: () => void; onDeleted: () => void }) {
  const navigate = useNavigate()
  const { openComposer } = useStore()
  const [keyText, setKeyText] = useState('')
  const [addingKey, setAddingKey] = useState(false)
  const [error, setError] = useState('')

  async function saveKey() {
    try {
      const fingerprint = await pgp.fingerprintOf(keyText)
      await patch(`/contacts/${contact.id}`, { pgpPublicKey: keyText.trim(), pgpFingerprint: fingerprint })
      setAddingKey(false)
      setError('')
      onChange()
    } catch (e) {
      setError(`That is not a valid public key: ${(e as Error).message}`)
    }
  }

  async function remove() {
    if (!confirm(`Delete ${contact.name} from your contacts?`)) return
    await del(`/contacts/${contact.id}`)
    onDeleted()
  }

  return (
    <div className="mx-auto grid max-w-[640px] gap-6 px-5 py-8 md:px-10">
      <button type="button" onClick={() => navigate('/contacts')} className="flex items-center gap-1.5 text-muted lg:hidden"><ArrowLeft size={16} /> Contacts</button>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={contact.name} size={64} />
        <div className="min-w-0">
          <h2 className="text-[23px] font-bold tracking-tight">{contact.name}</h2>
          {contact.company && <p className="text-muted">{contact.company}</p>}
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" aria-label={`Delete ${contact.name}`} onClick={remove}><Trash2 size={15} /></Button>
          <Button variant="primary" onClick={() => openComposer({ to: contact.emails[0] })}><Mail size={15} /> Email</Button>
        </div>
      </div>
      <dl className="grid gap-4 rounded-2xl border border-line bg-panel p-5">
        <div><dt className="text-[12px] font-semibold text-muted">Email</dt>{contact.emails.map((e) => <dd key={e}>{e}</dd>)}</div>
        {contact.phone && <div><dt className="text-[12px] font-semibold text-muted">Phone</dt><dd>{contact.phone}</dd></div>}
        <div><dt className="text-[12px] font-semibold text-muted">Messages</dt><dd>{contact.messageCount} sent to them from Nexus</dd></div>
      </dl>
      <div className="grid gap-3 rounded-2xl border border-line bg-panel p-5">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">PGP public key</h3>
          {contact.pgpPublicKey ? <Chip color="var(--news)">Mail to them can be encrypted</Chip> : <Chip color="var(--muted)">No key</Chip>}
        </div>
        {contact.pgpFingerprint && (
          <>
            <code className="rounded-lg bg-raise px-3 py-2 font-mono text-[12.5px] break-all text-ink-2">{pgp.formatFingerprint(contact.pgpFingerprint)}</code>
            <p className="text-[12.5px] text-muted">Compare this fingerprint with {contact.name.split(' ')[0]} in person before trusting it.</p>
          </>
        )}
        {addingKey ? (
          <div className="grid gap-2">
            <textarea value={keyText} onChange={(e) => setKeyText(e.target.value)} rows={6} aria-label="Public key" placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----" className="rounded-lg border border-line bg-raise p-3 font-mono text-[12px] focus:border-accent focus:outline-none" />
            <div className="flex gap-2"><Button variant="primary" onClick={saveKey}>Save key</Button><Button onClick={() => setAddingKey(false)}>Cancel</Button></div>
          </div>
        ) : (
          <Button variant="secondary" className="justify-self-start" onClick={() => setAddingKey(true)}><Upload size={15} /> {contact.pgpPublicKey ? 'Replace key' : 'Add public key'}</Button>
        )}
        {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      </div>
    </div>
  )
}
