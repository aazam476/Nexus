// Settings → Feeds: following and unfollowing feeds, deleting old posts (off by default), and moving
// your list of feeds to or from another feed reader as an OPML file. Reading happens on the Feeds page.
import { useQueryClient } from '@tanstack/react-query'
import { Download, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { AddFeed } from '../../components/feeds/AddFeed'
import { Button, Card } from '../../components/ui'
import { api, del, put } from '../../lib/api'
import { useFeeds, useMe } from '../../lib/queries'
import type { Feed } from '../../types'

// The choices for "Delete posts after". null = never (the default).
const RETENTION_CHOICES: { label: string; days: number | null }[] = [
  { label: 'Never', days: null },
  { label: '1 week', days: 7 },
  { label: '1 month', days: 30 },
  { label: '3 months', days: 90 },
  { label: '1 year', days: 365 },
]

export function FeedsSettings() {
  const client = useQueryClient()
  const refresh = () => {
    client.invalidateQueries({ queryKey: ['feeds'] })
    client.invalidateQueries({ queryKey: ['feed-items'] })
  }
  return (
    <>
      <FollowedFeeds onChange={refresh} />
      <OldPosts />
      <MoveFeeds onImported={refresh} />
    </>
  )
}

function FollowedFeeds({ onChange }: { onChange: () => void }) {
  const feeds = useFeeds().data ?? []

  async function unfollow(feed: Feed) {
    if (!confirm(`Stop following ${feed.title}? Its posts are removed from Nexus.`)) return
    await del(`/feeds/${feed.id}`)
    onChange()
  }

  return (
    <Card
      title="Your feeds"
      description="Paste a website’s address, or its feed’s. Most blogs and news sites have one. Feeds are checked every 30 minutes."
    >
      <div className="grid gap-4">
        <AddFeed onAdded={onChange} />
        {feeds.length > 0 && (
          <ul className="divide-y divide-line" aria-label="Followed feeds">
            {feeds.map((feed) => (
              <li key={feed.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{feed.title}</p>
                  {/* The last check failed: say why. It clears once the site works again. */}
                  {feed.error && <p className="truncate text-[12.5px] text-danger">Can’t update: {feed.error}</p>}
                </div>
                <Button variant="ghost" aria-label={`Unfollow ${feed.title}`} onClick={() => unfollow(feed)}>
                  <Trash2 size={14} /> Unfollow
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

function OldPosts() {
  const client = useQueryClient()
  const retention = useMe().data?.preferences.feedRetentionDays ?? null

  async function setRetention(value: string) {
    // The select's values are text ("30"); an empty one means "Never".
    await put('/auth/me/preferences', { feedRetentionDays: value === '' ? null : Number(value) })
    client.invalidateQueries({ queryKey: ['me'] })
  }

  return (
    <Card
      title="Old posts"
      description="Keep every post, or delete posts once they’re old. Starred posts are always kept."
    >
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
    </Card>
  )
}

function MoveFeeds({ onImported }: { onImported: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState('')

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
    <Card
      title="Move your feeds"
      description="Bring your feeds from another feed reader, or take them with you, as an OPML file."
    >
      <div className="grid gap-3">
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-raise px-3 py-1.5 text-[13px] hover:bg-hover"
          >
            <Download size={14} /> Export OPML
          </a>
        </div>
        {notice && <p role="status">{notice}</p>}
      </div>
    </Card>
  )
}
