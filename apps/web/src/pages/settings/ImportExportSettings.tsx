import { Download, Upload } from 'lucide-react'
import { Button, Card, Field } from '../../components/ui'
import { accounts } from '../../mock/data'

export function ImportExportSettings() {
  return (
    <>
      <Card title="Import mail" description="Bring in .eml files or .mbox archives from another client (Thunderbird, Apple Mail, Gmail Takeout).">
        <form className="grid gap-4" onSubmit={(e) => e.preventDefault()}>
          <label className="grid cursor-pointer place-items-center gap-2 rounded-xl border-2 border-dashed border-line bg-raise px-4 py-8 text-center hover:border-accent">
            <Upload size={22} className="text-muted" />
            <span className="font-medium">Drop .eml or .mbox files here</span>
            <span className="text-[12.5px] text-muted">or click to choose files</span>
            <input type="file" accept=".eml,.mbox,message/rfc822" multiple className="sr-only" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Into account">
              <select className="w-full rounded-lg border border-line bg-raise px-3 py-2 text-ink">{accounts.map((a) => <option key={a.id}>{a.email}</option>)}</select>
            </Field>
            <Field label="Folder">
              <select className="w-full rounded-lg border border-line bg-raise px-3 py-2 text-ink"><option>Archive</option><option>Inbox</option><option>New folder: Imported</option></select>
            </Field>
          </div>
          <Button type="submit" variant="primary" className="justify-self-start">Import</Button>
        </form>
      </Card>

      <Card title="Export mail" description="Download a folder as a standard .mbox file any mail client can open.">
        <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={(e) => e.preventDefault()}>
          <Field label="Account">
            <select className="w-full rounded-lg border border-line bg-raise px-3 py-2 text-ink"><option>All accounts</option>{accounts.map((a) => <option key={a.id}>{a.email}</option>)}</select>
          </Field>
          <Field label="Folder">
            <select className="w-full rounded-lg border border-line bg-raise px-3 py-2 text-ink"><option>Everything</option><option>Inbox</option><option>Sent</option><option>Archive</option></select>
          </Field>
          <Button type="submit"><Download size={15} /> Export .mbox</Button>
        </form>
      </Card>
    </>
  )
}
