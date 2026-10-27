// Fetching feeds from the web and saving their new posts.
import type { Feed } from '@prisma/client'
import { db } from '../../db.ts'
import { errorMessage } from '../../lib/http.ts'
import { findFeedLink, parseFeed, type ParsedFeed } from './parse.ts'

const TIMEOUT = 20_000
const MAX_BYTES = 5 * 1024 * 1024 // a feed bigger than this isn't a normal feed
const MAX_ITEMS = 100 // the newest posts kept from each fetch
export const REFRESH_EVERY = 30 * 60_000 // feeds change slowly; checking more often only adds load on their sites

// Downloads one address as text, refusing anything too large.
async function download(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'user-agent': 'Nexus feed reader', accept: 'application/rss+xml, application/atom+xml, text/xml, */*' },
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!response.ok) throw new Error(`The site answered ${response.status}`)
  if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error('The feed is too large')
  const text = await response.text()
  if (text.length > MAX_BYTES) throw new Error('The feed is too large')
  return text
}

// Fetches a feed. `url` may also be a website's address: then the feed it announces is used.
// Returns the feed's real address, since that's the one to keep checking.
export async function fetchFeed(url: string): Promise<{ url: string; feed: ParsedFeed }> {
  const text = await download(url)
  const feed = parseFeed(text)
  if (feed) return { url, feed }

  const announced = findFeedLink(text, url)
  if (!announced) throw new Error('No RSS or Atom feed found at that address')
  const announcedFeed = parseFeed(await download(announced))
  if (!announcedFeed) throw new Error('The feed this site points to could not be read')
  return { url: announced, feed: announcedFeed }
}

// Saves posts not seen before (the guid tells), newest first, at most MAX_ITEMS.
export async function saveItems(feedId: string, feed: ParsedFeed) {
  const newest = [...feed.items].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).slice(0, MAX_ITEMS)
  // skipDuplicates: posts already stored (same feed and guid) are left as they are, read or not.
  // shortcut: old posts are kept forever; delete ones older than a few months if the table grows too big.
  await db.feedItem.createMany({ data: newest.map((item) => ({ ...item, feedId })), skipDuplicates: true })
}

// Checks one feed for new posts. A failure is saved on the feed (and shown in the app), not thrown.
export async function refreshFeed(feed: Feed) {
  try {
    const { feed: parsed } = await fetchFeed(feed.url)
    await saveItems(feed.id, parsed)
    await db.feed.update({ where: { id: feed.id }, data: { lastFetchedAt: new Date(), error: null } })
  } catch (error) {
    await db.feed.update({ where: { id: feed.id }, data: { lastFetchedAt: new Date(), error: errorMessage(error) } })
  }
}

// Called by the background job every 2 minutes: refreshes the feeds checked longest ago, one at a time.
export async function refreshDueFeeds() {
  const due = await db.feed.findMany({
    where: { OR: [{ lastFetchedAt: null }, { lastFetchedAt: { lt: new Date(Date.now() - REFRESH_EVERY) } }] },
    orderBy: { lastFetchedAt: 'asc' },
  })
  for (const feed of due) await refreshFeed(feed)
}
