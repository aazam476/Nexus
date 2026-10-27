// Feeds, against a small website running inside the test, which serves an RSS feed, an Atom feed,
// a normal page announcing its feed, and some broken addresses.
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../db.ts'
import { signedInUser, startApp, waitFor } from '../../test/helpers.ts'
import { deleteOldPosts, refreshDueFeeds, REFRESH_EVERY } from './feeds.ts'

// The posts the fake site's RSS feed lists right now. Tests add to it to simulate new posts.
const posts = [
  { id: 'one', title: 'First post', date: 'Mon, 01 Jan 2030 09:00:00 GMT' },
  { id: 'two', title: 'Second post', date: 'Tue, 02 Jan 2030 09:00:00 GMT' },
]
let siteDown = false

const rssFeed =
  () => `<?xml version="1.0"?><rss version="2.0"><channel><title>Fake Blog</title><link>https://blog.test</link>
  ${posts.map((p) => `<item><title>${p.title}</title><guid>${p.id}</guid><link>https://blog.test/${p.id}</link><pubDate>${p.date}</pubDate><description>&lt;p&gt;Body of ${p.title}&lt;/p&gt;</description></item>`).join('')}
  </channel></rss>`
const atomFeed = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Notes</title><link href="https://notes.test/"/>
  <entry><title>Atom entry</title><id>atom-1</id><updated>2030-03-01T10:00:00Z</updated><content type="html">Hi</content></entry></feed>`

// One post from today and two from years ago, for the "delete old posts" setting.
const mixedAgesFeed = () => `<rss><channel><title>Mixed ages</title>
  <item><title>Fresh</title><guid>fresh</guid><pubDate>${new Date().toUTCString()}</pubDate></item>
  <item><title>Old starred</title><guid>old-a</guid><pubDate>Wed, 01 Jan 2020 09:00:00 GMT</pubDate></item>
  <item><title>Old plain</title><guid>old-b</guid><pubDate>Sat, 01 Feb 2020 09:00:00 GMT</pubDate></item>
</channel></rss>`

let app: Awaited<ReturnType<typeof startApp>>
let site: Server
let base = ''

beforeAll(async () => {
  app = await startApp()
  site = createServer((request, response) => {
    if (siteDown || request.url === '/broken') return response.writeHead(500).end('oops')
    if (request.url === '/feed.xml')
      return response.writeHead(200, { 'content-type': 'application/rss+xml' }).end(rssFeed())
    if (request.url === '/mixed.xml') return response.writeHead(200).end(mixedAgesFeed())
    if (request.url === '/atom.xml') return response.writeHead(200).end(atomFeed)
    if (request.url === '/notes') {
      return response
        .writeHead(200, { 'content-type': 'text/html' })
        .end('<html><head><link rel="alternate" type="application/atom+xml" href="/atom.xml"></head></html>')
    }
    response.writeHead(200, { 'content-type': 'text/html' }).end('<html><body>No feed here</body></html>')
  })
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(site.address() as { port: number }).port}`
})
afterAll(async () => {
  site.close()
  await app.close()
})

interface Item {
  id: string
  title: string
  feedTitle: string
  unread: boolean
  summary: string
}

describe('subscribing', () => {
  it('adds an RSS feed and its posts, newest first, all unread', async () => {
    const { browser } = await signedInUser(app)
    const feed = await browser.json('POST', '/api/feeds', { url: `${base}/feed.xml` })
    expect(feed).toMatchObject({ title: 'Fake Blog', siteUrl: 'https://blog.test', url: `${base}/feed.xml` })

    const items = await browser.json<Item[]>('GET', '/api/feed-items')
    expect(items.map((i) => [i.title, i.feedTitle, i.unread])).toEqual([
      ['Second post', 'Fake Blog', true],
      ['First post', 'Fake Blog', true],
    ])
    expect(items[0].summary).toBe('Body of Second post')
    expect((await browser.json('GET', '/api/feeds'))[0].unread).toBe(2)
  })

  it('finds the feed from a website address', async () => {
    const { browser } = await signedInUser(app)
    const feed = await browser.json('POST', '/api/feeds', { url: `${base}/notes` })
    expect(feed).toMatchObject({ title: 'Atom Notes', url: `${base}/atom.xml` })
  })

  it('says why an address cannot be added', async () => {
    const { browser } = await signedInUser(app)
    const error = async (url: string) => (await browser.post('/api/feeds', { url })).json().error
    expect(await error(`${base}/nothing`)).toMatch(/No RSS or Atom feed found/)
    expect(await error(`${base}/broken`)).toMatch(/answered 500/)
    expect(await error('ftp://files.test/feed')).toMatch(/http/)
    expect(await error('not a url')).toMatch(/web address/)

    await browser.json('POST', '/api/feeds', { url: `${base}/feed.xml` })
    expect(await error(`${base}/feed.xml`)).toMatch(/already follow/)
  })
})

describe('reading', () => {
  it('opens a post with its content and marks it read', async () => {
    const { browser } = await signedInUser(app)
    await browser.json('POST', '/api/feeds', { url: `${base}/feed.xml` })
    const [newest] = await browser.json<Item[]>('GET', '/api/feed-items')
    const full = await browser.json('GET', `/api/feed-items/${newest.id}`)
    expect(full).toMatchObject({ content: '<p>Body of Second post</p>', link: 'https://blog.test/two' })

    await browser.json('PATCH', `/api/feed-items/${newest.id}`, { unread: false })
    expect((await browser.json('GET', '/api/feeds'))[0].unread).toBe(1)
  })

  it('shows one feed at a time when asked', async () => {
    const { browser } = await signedInUser(app)
    const rss = await browser.json('POST', '/api/feeds', { url: `${base}/feed.xml` })
    await browser.json('POST', '/api/feeds', { url: `${base}/atom.xml` })
    expect(await browser.json<Item[]>('GET', '/api/feed-items')).toHaveLength(3)
    const onlyRss = await browser.json<Item[]>('GET', `/api/feed-items?feed=${rss.id}`)
    expect(onlyRss.map((i) => i.feedTitle)).toEqual(['Fake Blog', 'Fake Blog'])
  })

  it('keeps feeds private to each user', async () => {
    const owner = await signedInUser(app)
    const other = await signedInUser(app)
    const feed = await owner.browser.json('POST', '/api/feeds', { url: `${base}/feed.xml` })
    const [item] = await owner.browser.json<Item[]>('GET', '/api/feed-items')

    expect(await other.browser.json('GET', '/api/feed-items')).toEqual([])
    expect((await other.browser.get(`/api/feed-items/${item.id}`)).statusCode).toBe(404)
    expect((await other.browser.patch(`/api/feed-items/${item.id}`, { unread: false })).statusCode).toBe(404)
    expect((await other.browser.post(`/api/feeds/${feed.id}/refresh`)).statusCode).toBe(404)
    await other.browser.json('DELETE', `/api/feeds/${feed.id}`)
    expect(await owner.browser.json('GET', '/api/feeds')).toHaveLength(1)
  })

  it('removes a feed and its posts', async () => {
    const { browser } = await signedInUser(app)
    const feed = await browser.json('POST', '/api/feeds', { url: `${base}/feed.xml` })
    await browser.json('DELETE', `/api/feeds/${feed.id}`)
    expect(await browser.json('GET', '/api/feeds')).toEqual([])
    expect(await db.feedItem.count({ where: { feedId: feed.id } })).toBe(0)
  })
})

describe('refreshing', () => {
  it('adds new posts, keeps read ones read, and records a failure until the site is back', async () => {
    const { browser } = await signedInUser(app)
    const feed = await browser.json('POST', '/api/feeds', { url: `${base}/feed.xml` })
    const [second] = await browser.json<Item[]>('GET', '/api/feed-items')
    await browser.json('PATCH', `/api/feed-items/${second.id}`, { unread: false })

    posts.push({ id: 'three', title: 'Third post', date: 'Wed, 03 Jan 2030 09:00:00 GMT' })
    await browser.json('POST', `/api/feeds/${feed.id}/refresh`)
    const items = await browser.json<Item[]>('GET', '/api/feed-items')
    expect(items.map((i) => [i.title, i.unread])).toEqual([
      ['Third post', true],
      ['Second post', false],
      ['First post', true],
    ])

    siteDown = true
    expect((await browser.json('POST', `/api/feeds/${feed.id}/refresh`)).error).toMatch(/answered 500/)
    siteDown = false
    expect((await browser.json('POST', `/api/feeds/${feed.id}/refresh`)).error).toBeNull()
  })

  it('the background job checks only feeds that are due', async () => {
    const { browser } = await signedInUser(app)
    const fresh = await browser.json('POST', '/api/feeds', { url: `${base}/feed.xml` })
    const stale = await browser.json('POST', '/api/feeds', { url: `${base}/atom.xml` })
    const longAgo = new Date(Date.now() - REFRESH_EVERY - 60_000)
    await db.feed.update({ where: { id: stale.id }, data: { lastFetchedAt: longAgo } })
    const freshBefore = (await db.feed.findUniqueOrThrow({ where: { id: fresh.id } })).lastFetchedAt

    await refreshDueFeeds()
    expect((await db.feed.findUniqueOrThrow({ where: { id: stale.id } })).lastFetchedAt!.getTime()).toBeGreaterThan(
      longAgo.getTime(),
    )
    expect((await db.feed.findUniqueOrThrow({ where: { id: fresh.id } })).lastFetchedAt).toEqual(freshBefore)
  })
})

describe('starring and searching', () => {
  it('stars posts and lists only the starred ones', async () => {
    const { browser } = await signedInUser(app)
    await browser.json('POST', '/api/feeds', { url: `${base}/feed.xml` })
    const [first] = await browser.json<Item[]>('GET', '/api/feed-items')
    await browser.json('PATCH', `/api/feed-items/${first.id}`, { starred: true })
    expect((await browser.json<Item[]>('GET', '/api/feed-items?starred=true')).map((i) => i.id)).toEqual([first.id])
    await browser.json('PATCH', `/api/feed-items/${first.id}`, { starred: false })
    expect(await browser.json('GET', '/api/feed-items?starred=true')).toEqual([])
  })

  it('finds posts by words in the title or text, ignoring case', async () => {
    const { browser } = await signedInUser(app)
    await browser.json('POST', '/api/feeds', { url: `${base}/feed.xml` })
    const search = async (q: string) =>
      (await browser.json<Item[]>('GET', `/api/feed-items?q=${encodeURIComponent(q)}`)).map((i) => i.title)
    expect(await search('SECOND')).toEqual(['Second post'])
    expect(await search('body of first')).toEqual(['First post']) // matches the text, not just the title
    expect(await search('nothing like this')).toEqual([])
  })
})

describe('deleting old posts', () => {
  it('is off by default, then deletes old posts except starred ones, and never brings them back', async () => {
    const { browser } = await signedInUser(app)
    expect((await browser.json('GET', '/api/auth/me')).preferences.feedRetentionDays).toBeNull()
    const feed = await browser.json('POST', '/api/feeds', { url: `${base}/mixed.xml` })
    const titles = async () => (await browser.json<Item[]>('GET', '/api/feed-items')).map((i) => i.title).sort()
    expect(await titles()).toEqual(['Fresh', 'Old plain', 'Old starred'])

    const starred = (await browser.json<Item[]>('GET', '/api/feed-items')).find((i) => i.title === 'Old starred')!
    await browser.json('PATCH', `/api/feed-items/${starred.id}`, { starred: true })
    await browser.json('PUT', '/api/auth/me/preferences', { feedRetentionDays: 30 })
    await deleteOldPosts()
    expect(await titles()).toEqual(['Fresh', 'Old starred'])

    // The feed still lists "Old plain"; checking it again must not re-add it.
    await browser.json('POST', `/api/feeds/${feed.id}/refresh`)
    expect(await titles()).toEqual(['Fresh', 'Old starred'])

    expect((await browser.put('/api/auth/me/preferences', { feedRetentionDays: 0 })).statusCode).toBe(400)
    await browser.json('PUT', '/api/auth/me/preferences', { feedRetentionDays: null }) // back to keeping everything
    expect((await browser.json('GET', '/api/auth/me')).preferences.feedRetentionDays).toBeNull()
  })

  it('only affects the people who turned it on', async () => {
    const keeper = await signedInUser(app)
    const cleaner = await signedInUser(app)
    await keeper.browser.json('POST', '/api/feeds', { url: `${base}/mixed.xml` })
    await cleaner.browser.json('PUT', '/api/auth/me/preferences', { feedRetentionDays: 30 })
    await deleteOldPosts()
    expect(await keeper.browser.json<Item[]>('GET', '/api/feed-items')).toHaveLength(3)
  })
})

describe('OPML import and export', () => {
  it('exports your feeds, and importing adds the new ones and checks them in the background', async () => {
    const { browser } = await signedInUser(app)
    await browser.json('POST', '/api/feeds', { url: `${base}/feed.xml` })

    const exported = await browser.get('/api/feeds/export.opml')
    expect(exported.headers['content-type']).toBe('text/x-opml; charset=utf-8')
    expect(exported.body).toContain(`xmlUrl="${base}/feed.xml"`)

    const opml = `<opml version="2.0"><body>
      <outline text="Already followed" xmlUrl="${base}/feed.xml"/>
      <outline text="Folder"><outline text="Notes" xmlUrl="${base}/atom.xml"/></outline>
      <outline text="Not the web" xmlUrl="file:///etc/passwd"/>
    </body></opml>`
    expect(await browser.json('POST', '/api/feeds/import', { opml })).toEqual({ added: 1, skipped: 2 })

    // The new feed is fetched in the background, so wait for its post to arrive.
    await waitFor(
      async () => (await browser.json<Item[]>('GET', '/api/feed-items')).some((i) => i.title === 'Atom entry'),
      'the imported feed to be fetched',
    )
    const feeds = await browser.json<{ title: string }[]>('GET', '/api/feeds')
    // Imported feeds keep the name from the file (people often rename feeds in their old reader).
    expect(feeds.map((f) => f.title).sort()).toEqual(['Fake Blog', 'Notes'])
  })

  it('refuses a file that is not OPML', async () => {
    const { browser } = await signedInUser(app)
    expect((await browser.post('/api/feeds/import', { opml: '<rss/>' })).json().error).toMatch(/not an OPML file/)
  })
})
