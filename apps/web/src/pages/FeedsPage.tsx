// Feeds: follow websites' RSS or Atom feeds and read their posts here, like a small feed reader.
// On the left: following a feed, searching, filters, settings, and the posts. On the right: the open
// post. Side by side on wide screens, one at a time on phones.
//
// The parts live in components/feeds/: AddFeed, FeedFilters (all / starred / one feed),
// FeedSettings (deleting old posts, OPML import and export) and FeedReader.
import { useQueryClient } from '@tanstack/react-query'
import { Menu, Rss, Search, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router'
import type { ShellContext } from '../components/AppShell'
import { AddFeed } from '../components/feeds/AddFeed'
import { FeedFilters } from '../components/feeds/FeedFilters'
import { FeedReader } from '../components/feeds/FeedReader'
import { FeedSettings } from '../components/feeds/FeedSettings'
import { del, patch } from '../lib/api'
import { formatListDate } from '../lib/format'
import { useFeedItems, useFeeds } from '../lib/queries'
import type { Feed, FeedItem } from '../types'

export function FeedsPage() {
  const { itemId } = useParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const { openNav } = useOutletContext<ShellContext>()
  const [show, setShow] = useState('all') // 'all', 'starred', or a feed id
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const feeds = useFeeds().data ?? []
  const items = useFeedItems({ show, q: search }).data ?? []
  const selected = items.find((item) => item.id === itemId)
  const unread = feeds.reduce((total, feed) => total + feed.unread, 0)

  // Wait until typing pauses before asking the server to search.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchText.trim()), 300)
    return () => clearTimeout(timer)
  }, [searchText])

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
    if (show === feed.id) setShow('all')
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
          {feeds.length > 0 && (
            <label className="flex items-center gap-2 rounded-[9px] border border-line bg-raise px-2.5 py-1.5 text-muted focus-within:border-accent">
              <Search size={15} />
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search posts"
                aria-label="Search posts"
                className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-muted focus:outline-none"
              />
            </label>
          )}
        </header>

        <div className="flex-1 overflow-y-auto pb-6">
          {feeds.length > 0 && <FeedFilters feeds={feeds} show={show} onShow={setShow} onUnfollow={unfollow} />}
          <FeedSettings onImported={refresh} />
          {feeds.length === 0 && (
            <p className="px-6 py-16 text-center text-muted">
              Follow a website by pasting its address above. Most blogs and news sites have a feed.
            </p>
          )}
          {feeds.length > 0 && items.length === 0 && (
            <p className="px-6 py-10 text-center text-muted">
              {search ? `Nothing found for “${search}”.` : 'No posts here.'}
            </p>
          )}
          {items.map((item) => (
            <ItemRow key={item.id} item={item} selected={item.id === itemId} onOpen={() => open(item)} />
          ))}
        </div>
      </section>

      <section className={`h-full min-w-0 flex-1 overflow-y-auto bg-read ${selected ? '' : 'hidden lg:block'}`}>
        {selected ? <FeedReader itemId={selected.id} onBack={() => navigate('/feeds')} /> : <EmptyReader />}
      </section>
    </div>
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
        {item.starred && <Star size={12} className="shrink-0 fill-notif text-notif" aria-label="Starred" />}
        <span className="ml-auto shrink-0">{formatListDate(item.publishedAt)}</span>
      </span>
      <span className={`truncate ${item.unread ? 'font-bold text-ink' : 'text-ink-2'}`}>{item.title}</span>
      <span className="truncate text-[12.5px] text-muted">{item.summary}</span>
    </button>
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
