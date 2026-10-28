// Settings → PGP & S/MIME: create or import PGP keys (made and used in this browser) and upload
// S/MIME certificates (used on the server).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, KeyRound, Plus, Trash2, Upload } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button, Card, Chip, Field, Input, Select } from '../../components/ui'
import { api, del, fileToBase64 } from '../../lib/api'
import * as pgp from '../../lib/pgp'
import { useAccounts, useMe } from '../../lib/queries'

export function EncryptionSettings() {
  return (
    <>
      <PgpCard />
      <SmimeCard />
    </>
  )
}

function PgpCard() {
  const client = useQueryClient()
  const me = useMe().data
  const accounts = useAccounts().data ?? []
  const keys = useQuery({ queryKey: ['pgp-keys'], queryFn: () => api<pgp.StoredKey[]>('/pgp/keys') }).data ?? []
  const [mode, setMode] = useState<'generate' | 'import' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refresh = () => client.invalidateQueries({ queryKey: ['pgp-keys'] })

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>
    if (form.passphrase !== form.confirm) return setError('The passphrases don’t match')
    setBusy(true)
    setError('')
    try {
      const key =
        mode === 'generate'
          ? await pgp.generateKey(me?.name ?? '', form.email, form.passphrase)
          : await pgp.importPrivateKey(form.armored, form.passphrase)
      await api('/pgp/keys', { body: key })
      setMode(null)
      refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function exportPublic(key: pgp.StoredKey) {
    const url = URL.createObjectURL(new Blob([key.publicKey], { type: 'application/pgp-keys' }))
    const link = Object.assign(document.createElement('a'), {
      href: url,
      download: `${key.fingerprint.slice(-16)}.asc`,
    })
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card
      title="PGP keys"
      description="Keys are made and used in your browser. Nexus stores your private key only locked with your passphrase, so the server can never read your encrypted mail."
      actions={
        !mode && (
          <div className="flex gap-2">
            <Button onClick={() => setMode('import')}>
              <Upload size={15} /> Import
            </Button>
            <Button variant="primary" onClick={() => setMode('generate')}>
              <Plus size={15} /> Create key
            </Button>
          </div>
        )
      }
    >
      <div className="grid gap-3">
        {mode && (
          <form onSubmit={submit} className="grid gap-3 rounded-xl border border-line p-4">
            {mode === 'generate' ? (
              <Field label="Email address on the key">
                <Select name="email" className="w-full">
                  {[...new Set([me?.email, ...accounts.map((a) => a.email)])].filter(Boolean).map((email) => (
                    <option key={email}>{email}</option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field
                label="Private key"
                hint="Paste an exported private key (it starts with -----BEGIN PGP PRIVATE KEY BLOCK-----)."
              >
                <textarea
                  name="armored"
                  rows={6}
                  required
                  className="rounded-lg border border-line bg-raise p-3 font-mono text-[12px] focus:border-accent focus:outline-none"
                />
              </Field>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Passphrase"
                hint="Needed to read encrypted mail. If you lose it, the key can’t be recovered."
              >
                <Input name="passphrase" type="password" minLength={8} required autoComplete="new-password" />
              </Field>
              <Field label="Repeat passphrase">
                <Input name="confirm" type="password" required autoComplete="new-password" />
              </Field>
            </div>
            {error && (
              <p role="alert" className="text-[13px] text-danger">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" variant="primary" disabled={busy}>
                {busy && 'Working…'}
                {!busy && (mode === 'generate' ? 'Create key' : 'Import key')}
              </Button>
              <Button onClick={() => setMode(null)}>Cancel</Button>
            </div>
          </form>
        )}
        {keys.length === 0 && !mode && <p className="text-muted">No PGP key yet.</p>}
        {keys.map((key) => (
          <div key={key.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-raise p-4">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-panel text-news">
              <KeyRound size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{key.userIds.join(', ')}</p>
              <code className="block truncate font-mono text-[12.5px] text-muted">
                {pgp.formatFingerprint(key.fingerprint)}
              </code>
            </div>
            {key.isDefault ? (
              <Chip color="var(--news)">Default</Chip>
            ) : (
              <Button variant="ghost" onClick={() => api(`/pgp/keys/${key.id}/default`, { body: {} }).then(refresh)}>
                Make default
              </Button>
            )}
            <Button
              variant="ghost"
              title="Export public key"
              aria-label="Export public key"
              onClick={() => exportPublic(key)}
            >
              <Download size={15} />
            </Button>
            <Button
              variant="ghost"
              aria-label="Delete key"
              onClick={() => {
                if (confirm('Delete this key? Mail encrypted to it can no longer be read here.'))
                  del(`/pgp/keys/${key.id}`).then(refresh)
              }}
            >
              <Trash2 size={15} />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  )
}

function SmimeCard() {
  const client = useQueryClient()
  const certs =
    useQuery({
      queryKey: ['smime'],
      queryFn: () => api<{ id: string; email: string; subject: string; expiresAt: string }[]>('/smime'),
    }).data ?? []
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const refresh = () => client.invalidateQueries({ queryKey: ['smime'] })

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      await api('/smime', {
        body: { p12: await fileToBase64(form.get('file') as File), password: form.get('password') },
      })
      setUploading(false)
      setError('')
      refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Card
      title="S/MIME certificates"
      description="Upload a certificate from your organisation or a CA as a .p12 or .pfx file. Used to sign, encrypt and read S/MIME mail."
      actions={
        !uploading && (
          <Button onClick={() => setUploading(true)}>
            <Upload size={15} /> Upload certificate
          </Button>
        )
      }
    >
      <div className="grid gap-3">
        {uploading && (
          <form onSubmit={upload} className="grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-2">
            <Field label="Certificate file">
              <input name="file" type="file" accept=".p12,.pfx,application/x-pkcs12" required className="text-[13px]" />
            </Field>
            <Field label="File password">
              <Input name="password" type="password" autoComplete="off" />
            </Field>
            {error && (
              <p role="alert" className="text-[13px] text-danger sm:col-span-2">
                {error}
              </p>
            )}
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" variant="primary">
                Upload
              </Button>
              <Button onClick={() => setUploading(false)}>Cancel</Button>
            </div>
          </form>
        )}
        {certs.length === 0 && !uploading && <p className="text-muted">No certificate yet.</p>}
        {certs.map((cert) => (
          <div key={cert.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-raise p-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{cert.email}</p>
              <p className="truncate text-[12.5px] text-muted">
                {cert.subject} · expires {new Date(cert.expiresAt).toLocaleDateString()}
              </p>
            </div>
            <Button
              variant="ghost"
              aria-label="Delete certificate"
              onClick={() => del(`/smime/${cert.id}`).then(refresh)}
            >
              <Trash2 size={15} />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  )
}
