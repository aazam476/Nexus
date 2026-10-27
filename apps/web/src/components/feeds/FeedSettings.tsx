// Settings for feeds: deleting old posts (off by default), and moving your list of feeds to or from
// another feed reader as an OPML file.
import { useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { api, put } from '../../lib/api'
import { useMe } from '../../lib/queries'
import { Button } from '../ui'

// The choices for "Delete posts after". null = never (the default).
const RETENTION_CHOICES: { label: string; days: number | null }[] = [
  { label: 'Never', days: null },
  { label: '1 week', days: 7 },
  { label: '1 month', days: 30 },
  { label: '3 months', days: 90 },
  { label: '1 year', days: 365 },
]

export function FeedSettings({ onImported }: { onImported: () => void }) {
  const client = useQueryClient()
  const me = useMe().data
  const retention = me?.preferences.feedRetentionDays ?? null
  const fileInput = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState('')

  async function setRetention(value: string) {
    // The select's values are text ("30"); an empty one means "Never".
    await put('/auth/me/preferences', { feedRetentionDays: value === '' ? null : Number(value) })
    client.invalidateQueries({ queryKey: ['me'] })
  }

  async function importOpml(file: File) {
    try {
      const result = await api<{ added: number; skipped: number }>('/feeds/import', {
        body: { opml: await file.text() },
      })
      const skipped = result.skipped > 0 ? ` (${result.skipped} skipped: already followed or not web addresses)` : ''
      setNotice(
        `Following ${result.added} new feed${result.added === 1 ? '' : 's'}${skipped}. Their posts arrive in a moment.`,
      )
      onImported()
    } catch (e) {
      setNotice((e as Error).message)
    }
  }

  return (
    <div className="grid gap-2 border-b border-line px-4 py-3 text-[13px]">
      <label className="flex items-center gap-2 text-ink-2">
        Delete posts after
        <select
          value={retention ?? ''}
          onChange={(event) => setRetention(event.target.value)}
          className="rounded-lg border border-line bg-raise px-2 py-1 text-ink"
        >
          {RETENTION_CHOICES.map(({ label, days }) => (
            <option key={label} value={days ?? ''}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {retention !== null && <p className="text-[12px] text-muted">Starred posts are always kept.</p>}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => fileInput.current?.click()}>
          <Upload size={14} /> Import OPML
        </Button>
        {/* The real file picker, hidden; the button above opens it. */}
        <input
          ref={fileInput}
          type="file"
          accept=".opml,.xml,text/x-opml,text/xml"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) importOpml(file)
            event.target.value = '' // so picking the same file again still counts as a change
          }}
        />
        <a
          href="/api/feeds/export.opml"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-raise px-3 py-1.5 hover:bg-hover"
        >
          <Download size={14} /> Export OPML
        </a>
      </div>
      {notice && <p role="status">{notice}</p>}
    </div>
  )
}
