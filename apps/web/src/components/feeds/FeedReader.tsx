// Reading one feed post: its title and source, a star button, a link to the original, and the post
// itself, shown in the same sanitized sandbox as email (it's HTML from another website).
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink, Star } from 'lucide-react'
import { patch } from '../../lib/api'
import { formatFullDate } from '../../lib/format'
import { useFeedItem } from '../../lib/queries'
import { SafeHtml } from '../SafeHtml'
import { Button } from '../ui'

export function FeedReader({ itemId, onBack }: { itemId: string; onBack: () => void }) {
  const client = useQueryClient()
  const item = useFeedItem(itemId).data
  if (!item) return <p className="p-6 text-muted">Loading…</p>

  async function toggleStar() {
    await patch(`/feed-items/${itemId}`, { starred: !item!.starred })
    client.invalidateQueries({ queryKey: ['feed-item', itemId] })
    client.invalidateQueries({ queryKey: ['feed-items'] })
  }

  const byline = [item.feedTitle, item.author, formatFullDate(item.publishedAt)].filter(Boolean).join(' · ')
  return (
    <article className="mx-auto grid max-w-[820px] gap-5 px-4 py-6 lg:px-10" aria-label={item.title}>
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-muted lg:hidden">
        <ArrowLeft size={16} /> Back
      </button>
      <h1 className="text-[23px] leading-tight font-bold tracking-tight text-balance">{item.title}</h1>
      <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
        <span>{byline}</span>
        <Button
          variant="ghost"
          onClick={toggleStar}
          aria-pressed={item.starred}
          className={item.starred ? '[&_svg]:fill-notif [&_svg]:text-notif' : ''}
        >
          <Star size={15} /> {item.starred ? 'Starred' : 'Star'}
        </Button>
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
      {item.content ? <SafeHtml html={item.content} /> : <p className="text-muted">{item.summary}</p>}
    </article>
  )
}
