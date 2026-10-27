// Feeds: follow websites' RSS or Atom feeds and read their posts here, like a small feed reader.
// On the left: adding a feed, your feeds (to filter by one), and the posts. On the right: the open
// post, shown safely in the same sandbox as email. Side by side on wide screens, one at a time on phones.
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink, Menu, Rss, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router'
import type { ShellContext } from '../components/AppShell'
import { SafeHtml } from '../components/SafeHtml'
import { Button, Input } from '../components/ui'
import { api, del, patch } from '../lib/api'
import { formatFullDate, formatListDate } from '../lib/format'
import { useFeedItem, useFeedItems, useFeeds } from '../lib/queries'
import type { Feed, FeedItem } from '../types'

export function FeedsPage() {
  const { itemId } = useParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const { openNav } = useOutletContext<ShellContext>()
  const [feedFilter, setFeedFilter] = useState<string | null>(null) // null = all feeds
  const feeds = useFeeds().data ?? []
  const items = useFeedItems(feedFilter).data ?? []
  const selected = items.find((item) => item.id === itemId)
  const unread = feeds.reduce((total, feed) => total + feed.unread, 0)

  const refresh = () => {
    client.invalidateQueries({ queryKey: ['feeds'] })
    client.invalidateQueries({ queryKey: ['feed-items'] })
  }

  async function open(item: FeedItem) {
    navigate(`/feeds/${item.id}`)
    if (item.unread) {
      await patch(`/feed-items/${item.id}`, { unread: false })
      refresh()
    }
  }

  async function unfollow(feed: Feed) {
    if (!confirm(`Stop following ${feed.title}? Its posts are removed from Nexus.`)) return
    await del(`/feeds/${feed.id}`)
    if (feedFilter === feed.id) setFeedFilter(null)
    refresh()
  }

  return (
    <div className="flex h-full">
      <section
        aria-label="Feeds"
        className={`h-full flex-col overflow-hidden border-r border-line bg-panel lg:flex lg:w-[380px] lg:shrink-0 ${selected ? 'hidden' : 'flex w-full'}`}
      >
        <header className="grid gap-2.5 px-3.5 pt-3.5 pb-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Open menu"
              onClick={openNav}
              className="-ml-1 rounded-md p-1 text-muted hover:bg-raise md:hidden"
            >
              <Menu size={18} />
            </button>
            <h1 className="text-[19px] font-bold tracking-tight">Feeds</h1>
            <span className="ml-auto text-[12px] text-muted">{unread > 0 ? `${unread} unread` : 'All read'}</span>
          </div>
          <AddFeed onAdded={refresh} />
        </header>

        <div className="flex-1 overflow-y-auto pb-6">
          {feeds.length > 0 && (
            <FeedFilters feeds={feeds} current={feedFilter} onPick={setFeedFilter} onUnfollow={unfollow} />
          )}
          {feeds.length === 0 && (
            <p className="px-6 py-16 text-center text-muted">
              Follow a website by pasting its address above. Most blogs and news sites have a feed.
            </p>
          )}
          {items.map((item) => (
            <ItemRow key={item.id} item={item} selected={item.id === itemId} onOpen={() => open(item)} />
          ))}
        </div>
      </section>

      <section className={`h-full min-w-0 flex-1 overflow-y-auto bg-read ${selected ? '' : 'hidden lg:block'}`}>
        {selected ? <ItemReader itemId={selected.id} onBack={() => navigate('/feeds')} /> : <EmptyReader />}
      </section>
    </div>
  )
}

function AddFeed({ onAdded }: { onAdded: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const url = String(new FormData(form).get('url') ?? '')
    setBusy(true)
    setError('')
    try {
      await api('/feeds', { body: { url } })
      form.reset()
      onAdded()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={add} className="grid gap-1.5">
      <div className="flex gap-2">
        <Input
          name="url"
          type="url"
          required
          placeholder="https://example.com or its feed"
          aria-label="Feed or website address"
        />
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Adding…' : 'Follow'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </form>
  )
}

// "All feeds" and one button per feed, to show only that feed's posts. Each feed can be unfollowed here.
function FeedFilters(props: {
  feeds: Feed[]
  current: string | null
  onPick: (feedId: string | null) => void
  onUnfollow: (feed: Feed) => void
}) {
  const { feeds, current, onPick, onUnfollow } = props
  const itemClass = (active: boolean) =>
    `flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left ${active ? 'bg-raise font-semibold' : 'text-ink-2 hover:bg-hover'}`

  return (
    <ul className="grid gap-0.5 border-b border-line px-2 pb-2" aria-label="Your feeds">
      <li>
        <button type="button" onClick={() => onPick(null)} className={itemClass(current === null)}>
          <Rss size={15} className="text-muted" /> All feeds
        </button>
      </li>
      {feeds.map((feed) => (
        <li key={feed.id} className="flex items-center gap-1">
          <button type="button" onClick={() => onPick(feed.id)} className={itemClass(current === feed.id)}>
            <span className="truncate">{feed.title}</span>
            {feed.error && (
              <span className="shrink-0 text-[12px] text-danger" title={feed.error}>
                Can’t update
              </span>
            )}
            {feed.unread > 0 && <span className="ml-auto text-[12px] text-muted">{feed.unread}</span>}
          </button>
          <button
            type="button"
            aria-label={`Unfollow ${feed.title}`}
            title="Unfollow"
            onClick={() => onUnfollow(feed)}
            className="rounded-md p-1.5 text-muted hover:bg-raise hover:text-danger"
          >
            <Trash2 size={14} />
          </button>
        </li>
      ))}
    </ul>
  )
}

function ItemRow({ item, selected, onOpen }: { item: FeedItem; selected: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={selected ? 'true' : undefined}
      className={`mx-1.5 mt-1 grid w-[calc(100%-12px)] gap-0.5 rounded-[10px] px-3 py-2 text-left ${selected ? 'bg-sel ring-1 ring-sel-line' : 'hover:bg-hover'}`}
    >
      <span className="flex items-center gap-2 text-[12px] text-muted">
        <span className="truncate">{item.feedTitle}</span>
        <span className="ml-auto shrink-0">{formatListDate(item.publishedAt)}</span>
      </span>
      <span className={`truncate ${item.unread ? 'font-bold text-ink' : 'text-ink-2'}`}>{item.title}</span>
      <span className="truncate text-[12.5px] text-muted">{item.summary}</span>
    </button>
  )
}

function ItemReader({ itemId, onBack }: { itemId: string; onBack: () => void }) {
  const item = useFeedItem(itemId).data
  if (!item) return <p className="p-6 text-muted">Loading…</p>
  const byline = [item.feedTitle, item.author, formatFullDate(item.publishedAt)].filter(Boolean).join(' · ')

  return (
    <article className="mx-auto grid max-w-[820px] gap-5 px-4 py-6 @container @xl:px-10" aria-label={item.title}>
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-muted lg:hidden">
        <ArrowLeft size={16} /> Back
      </button>
      <h1 className="text-[23px] leading-tight font-bold tracking-tight text-balance">{item.title}</h1>
      <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
        <span>{byline}</span>
        {item.link && (
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1.5 text-accent-text hover:underline"
          >
            Open original <ExternalLink size={13} />
          </a>
        )}
      </div>
      {/* Feed posts are HTML from other websites, so they get the same sanitizing and sandbox as email. */}
      {item.content ? <SafeHtml html={item.content} /> : <p className="text-muted">{item.summary}</p>}
    </article>
  )
}

function EmptyReader() {
  return (
    <div className="grid h-full place-items-center text-center">
      <div className="grid justify-items-center gap-3">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-raise text-muted">
          <Rss size={24} />
        </span>
        <p className="text-muted">Pick a post to read it.</p>
      </div>
    </div>
  )
}
