// Subscribing to feeds and reading their posts. Each user only ever sees their own feeds.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../../db.ts'
import { badRequest, errorMessage, notFound, parse } from '../../lib/http.ts'
import { requireUser } from '../../lib/session.ts'
import { fetchFeed, refreshFeed, saveItems } from './feeds.ts'

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
    if (!/^https?:\/\//i.test(url)) throw badRequest('Feeds must be http:// or https:// addresses')

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
    await saveItems(feed.id, fetched.feed)
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

  // Posts, newest first: from every feed, or one (?feed=id). Without their full content, which
  // opening a post loads.
  app.get('/feed-items', async (request) => {
    const query = parse(
      z.object({ feed: z.string().optional(), limit: z.coerce.number().int().min(1).max(1000).default(200) }),
      request.query,
    )
    const items = await db.feedItem.findMany({
      where: { feed: { userId: request.user.id }, ...(query.feed && { feedId: query.feed }) },
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

  app.patch<{ Params: { id: string } }>('/feed-items/:id', async (request) => {
    const { unread } = parse(z.object({ unread: z.boolean() }), request.body)
    const updated = await db.feedItem.updateMany({
      where: { id: request.params.id, feed: { userId: request.user.id } },
      data: { unread },
    })
    if (!updated.count) throw notFound('Post')
    return { ok: true }
  })
}
