// Settings → Import & export: upload .eml/.mbox files into an account, download mail as .mbox.
import { Download, Upload } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button, Card, Field, Select } from '../../components/ui'
import { api } from '../../lib/api'
import { useAccounts, useRefreshMail } from '../../lib/queries'

export function ImportExportSettings() {
  const accounts = useAccounts().data ?? []
  const refresh = useRefreshMail()
  const [files, setFiles] = useState<File[]>([])
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [exportAccount, setExportAccount] = useState('')
  const [exportFolder, setExportFolder] = useState('')

  async function importMail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    form.delete('files')
    files.forEach((file) => form.append('files', file, file.name))
    setStatus({ ok: true, text: 'Importing…' })
    try {
      const result = await api<{ imported: number }>('/import', { form })
      setStatus({
        ok: true,
        text: `Imported ${result.imported} message${result.imported === 1 ? '' : 's'}. IMAP accounts show them after the next sync.`,
      })
      setFiles([])
      refresh()
    } catch (e) {
      setStatus({ ok: false, text: (e as Error).message })
    }
  }

  const exportUrl = `/api/export.mbox?${new URLSearchParams(Object.entries({ account: exportAccount, folder: exportFolder }).filter(([, v]) => v))}`

  return (
    <>
      <Card
        title="Import mail"
        description="Bring in .eml files or .mbox archives from another client (Thunderbird, Apple Mail, Gmail Takeout)."
      >
        <form className="grid gap-4" onSubmit={importMail}>
          <label
            className="grid cursor-pointer place-items-center gap-2 rounded-xl border-2 border-dashed border-line bg-raise px-4 py-8 text-center hover:border-accent"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              setFiles([...files, ...Array.from(e.dataTransfer.files)])
            }}
          >
            <Upload size={22} className="text-muted" />
            <span className="font-medium">
              {files.length ? files.map((f) => f.name).join(', ') : 'Drop .eml or .mbox files here'}
            </span>
            <span className="text-[12.5px] text-muted">or click to choose files</span>
            <input
              name="files"
              type="file"
              accept=".eml,.mbox,message/rfc822,application/mbox"
              multiple
              className="sr-only"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Into account">
              <Select name="accountId" className="w-full" required>
                {accounts
                  .filter((a) => a.role !== 'viewer')
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.email}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Folder">
              <Select name="folder" defaultValue="archive" className="w-full">
                <option value="archive">Archive</option>
                <option value="inbox">Inbox</option>
                <option value="sent">Sent</option>
              </Select>
            </Field>
          </div>
          {status && (
            <p
              role={status.ok ? 'status' : 'alert'}
              className={`text-[13px] ${status.ok ? 'text-muted' : 'text-danger'}`}
            >
              {status.text}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            className="justify-self-start"
            disabled={!files.length || !accounts.length}
          >
            Import
          </Button>
        </form>
      </Card>

      <Card title="Export mail" description="Download mail as a standard .mbox file any mail client can open.">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Account">
            <Select value={exportAccount} onChange={(e) => setExportAccount(e.target.value)} className="w-full">
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.email}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Folder">
            <Select value={exportFolder} onChange={(e) => setExportFolder(e.target.value)} className="w-full">
              <option value="">Everything</option>
              <option value="inbox">Inbox</option>
              <option value="sent">Sent</option>
              <option value="archive">Archive</option>
              <option value="spam">Spam</option>
              <option value="trash">Trash</option>
            </Select>
          </Field>
          <a
            href={exportUrl}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-raise px-3 py-1.5 text-[13px] hover:bg-hover"
          >
            <Download size={15} /> Export .mbox
          </a>
        </div>
      </Card>
    </>
  )
}
