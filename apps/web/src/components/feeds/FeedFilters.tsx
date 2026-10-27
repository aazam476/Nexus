// What to show: all posts, starred posts, or one feed's.
import { Rss, Star } from 'lucide-react'
import type { Feed } from '../../types'

interface Props {
  feeds: Feed[]
  show: string // 'all', 'starred', or a feed id
  onShow: (show: string) => void
}

export function FeedFilters({ feeds, show, onShow }: Props) {
  const itemClass = (active: boolean) =>
    `flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left ${active ? 'bg-raise font-semibold' : 'text-ink-2 hover:bg-hover'}`

  return (
    <ul className="grid gap-0.5 border-b border-line px-2 pb-2" aria-label="Your feeds">
      <li>
        <button type="button" onClick={() => onShow('all')} className={itemClass(show === 'all')}>
          <Rss size={15} className="text-muted" /> All feeds
        </button>
      </li>
      <li>
        <button type="button" onClick={() => onShow('starred')} className={itemClass(show === 'starred')}>
          <Star size={15} className="text-muted" /> Starred
        </button>
      </li>
      {feeds.map((feed) => (
        <li key={feed.id} className="flex">
          <button type="button" onClick={() => onShow(feed.id)} className={itemClass(show === feed.id)}>
            <span className="truncate">{feed.title}</span>
            {/* The last check failed: say so, with the reason on hover. It clears once the site works again. */}
            {feed.error && (
              <span className="shrink-0 text-[12px] text-danger" title={feed.error}>
                Can’t update
              </span>
            )}
            {feed.unread > 0 && <span className="ml-auto text-[12px] text-muted">{feed.unread}</span>}
          </button>
        </li>
      ))}
    </ul>
  )
}
