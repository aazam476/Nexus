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

// ---------- Deleting old posts ----------
// Off by default. When someone sets "delete posts after N days" (Preference.feedRetentionDays),
// posts published before that are deleted, except starred ones.

const DAY = 86_400_000

// The oldest a post may be for this user, or null when they keep everything.
async function retentionCutoff(userId: string): Promise<Date | null> {
  const preference = await db.preference.findUnique({ where: { userId }, select: { feedRetentionDays: true } })
  const days = preference?.feedRetentionDays
  return days ? new Date(Date.now() - days * DAY) : null
}

// Called by the background job: applies everyone's setting.
export async function deleteOldPosts() {
  const preferences = await db.preference.findMany({ where: { feedRetentionDays: { not: null } } })
  for (const { userId, feedRetentionDays } of preferences) {
    const cutoff = new Date(Date.now() - feedRetentionDays! * DAY)
    await db.feedItem.deleteMany({ where: { feed: { userId }, starred: false, publishedAt: { lt: cutoff } } })
  }
}

// ---------- Saving and refreshing ----------

// Saves posts not seen before (the guid tells), newest first, at most MAX_ITEMS.
export async function saveItems(feed: { id: string; userId: string }, parsed: ParsedFeed) {
  // Posts older than the user's cut-off are left out. A deleted post is usually still listed in
  // the feed; without this, the next check would bring it back as unread.
  const cutoff = await retentionCutoff(feed.userId)
  const recent = parsed.items.filter((item) => !cutoff || item.publishedAt >= cutoff)
  const newest = recent.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).slice(0, MAX_ITEMS)
  // skipDuplicates: posts already stored (same feed and guid) are left as they are, read or not.
  await db.feedItem.createMany({ data: newest.map((item) => ({ ...item, feedId: feed.id })), skipDuplicates: true })
}

// Checks one feed for new posts. A failure is saved on the feed (and shown in the app), not thrown.
export async function refreshFeed(feed: Feed) {
  try {
    const { feed: parsed } = await fetchFeed(feed.url)
    await saveItems(feed, parsed)
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
