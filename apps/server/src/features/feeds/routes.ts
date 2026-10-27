// Subscribing to feeds and reading their posts. Each user only ever sees their own feeds.
import type { Feed, Prisma } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../../db.ts'
import { badRequest, errorMessage, notFound, parse } from '../../lib/http.ts'
import { requireUser } from '../../lib/session.ts'
import { fetchFeed, refreshFeed, saveItems } from './feeds.ts'
import { buildOpml, parseOpml } from './opml.ts'

// Only http:// and https:// addresses: never file:// or other schemes that read from the server itself.
const isWebAddress = (url: string) => /^https?:\/\//i.test(url)

export async function feedRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser)

  // Your feeds, each with how many unread posts it has.
  app.get('/feeds', async (request) => {
    const feeds = await db.feed.findMany({
      where: { userId: request.user.id },
      include: { _count: { select: { items: { where: { unread: true } } } } },
      orderBy: { title: 'asc' },
    })
    return feeds.map(({ _count, ...feed }) => ({ ...feed, unread: _count.items }))
  })

  // Subscribe. The address is fetched straight away, so a wrong one is refused with the reason.
  app.post('/feeds', async (request) => {
    const { url } = parse(
      z.object({ url: z.string().trim().url('Enter a web address, like https://example.com/feed') }),
      request.body,
    )
    if (!isWebAddress(url)) throw badRequest('Feeds must be http:// or https:// addresses')

    let fetched: Awaited<ReturnType<typeof fetchFeed>>
    try {
      fetched = await fetchFeed(url)
    } catch (error) {
      throw badRequest(`Could not add that feed: ${errorMessage(error)}`)
    }
    const key = { userId: request.user.id, url: fetched.url }
    if (await db.feed.findUnique({ where: { userId_url: key } })) throw badRequest('You already follow this feed')

    const feed = await db.feed.create({
      data: { ...key, title: fetched.feed.title, siteUrl: fetched.feed.siteUrl, lastFetchedAt: new Date() },
    })
    await saveItems(feed, fetched.feed)
    return feed
  })

  app.delete<{ Params: { id: string } }>('/feeds/:id', async (request) => {
    await db.feed.deleteMany({ where: { id: request.params.id, userId: request.user.id } })
    return { ok: true }
  })

  // "Check now", instead of waiting for the next background refresh.
  app.post<{ Params: { id: string } }>('/feeds/:id/refresh', async (request) => {
    const feed = await db.feed.findFirst({ where: { id: request.params.id, userId: request.user.id } })
    if (!feed) throw notFound('Feed')
    await refreshFeed(feed)
    return db.feed.findUniqueOrThrow({ where: { id: feed.id } })
  })

  // Posts, newest first, without their full content (opening a post loads it). Optionally only:
  //   ?feed=id       one feed's posts
  //   ?starred=true  starred posts
  //   ?q=words       posts whose title or text contains the words
  app.get('/feed-items', async (request) => {
    const query = parse(
      z.object({
        feed: z.string().optional(),
        starred: z.enum(['true']).optional(),
        q: z.string().trim().optional(),
        limit: z.coerce.number().int().min(1).max(1000).default(200),
      }),
      request.query,
    )
    const where: Prisma.FeedItemWhereInput = { feed: { userId: request.user.id } }
    if (query.feed) where.feedId = query.feed
    if (query.starred) where.starred = true
    if (query.q) {
      const contains = { contains: query.q, mode: 'insensitive' as const } // case doesn't matter
      where.OR = [{ title: contains }, { content: contains }]
    }
    const items = await db.feedItem.findMany({
      where,
      omit: { content: true },
      include: { feed: { select: { title: true } } },
      orderBy: { publishedAt: 'desc' },
      take: query.limit,
    })
    return items.map(({ feed, ...item }) => ({ ...item, feedTitle: feed.title }))
  })

  app.get<{ Params: { id: string } }>('/feed-items/:id', async (request) => {
    const item = await db.feedItem.findFirst({
      where: { id: request.params.id, feed: { userId: request.user.id } },
      include: { feed: { select: { title: true } } },
    })
    if (!item) throw notFound('Post')
    const { feed, ...rest } = item
    return { ...rest, feedTitle: feed.title }
  })

  // Mark a post read or unread, starred or not.
  app.patch<{ Params: { id: string } }>('/feed-items/:id', async (request) => {
    const changes = parse(z.object({ unread: z.boolean().optional(), starred: z.boolean().optional() }), request.body)
    const updated = await db.feedItem.updateMany({
      where: { id: request.params.id, feed: { userId: request.user.id } },
      data: changes,
    })
    if (!updated.count) throw notFound('Post')
    return { ok: true }
  })

  // ---------- Moving feeds between apps (OPML) ----------

  app.get('/feeds/export.opml', async (request, reply) => {
    const feeds = await db.feed.findMany({ where: { userId: request.user.id }, orderBy: { title: 'asc' } })
    return reply
      .header('content-type', 'text/x-opml; charset=utf-8')
      .header('content-disposition', 'attachment; filename="nexus-feeds.opml"')
      .send(buildOpml(feeds))
  })

  // Adds every feed in an OPML file that you don't follow yet. To keep the request quick, the
  // feeds aren't fetched here: each one is checked in the background (see refreshImported).
  app.post('/feeds/import', { bodyLimit: 3 * 1024 * 1024 }, async (request) => {
    const { opml } = parse(z.object({ opml: z.string().max(2_000_000) }), request.body)
    const listed = parseOpml(opml)
    if (!listed) throw badRequest('That is not an OPML file')

    const added: Feed[] = []
    let skipped = 0
    for (const { title, url } of listed) {
      const key = { userId: request.user.id, url }
      const usable = isWebAddress(url) && !(await db.feed.findUnique({ where: { userId_url: key } }))
      if (!usable) {
        skipped++ // not a web address, or already followed
        continue
      }
      added.push(await db.feed.create({ data: { ...key, title } }))
    }
    void refreshImported(added) // not awaited: it carries on after the answer is sent
    return { added: added.length, skipped }
  })
}

// Fetches newly imported feeds one after another. refreshFeed records failures instead of throwing,
// so this can run on its own after the request has finished.
async function refreshImported(feeds: Feed[]) {
  for (const feed of feeds) await refreshFeed(feed)
}
