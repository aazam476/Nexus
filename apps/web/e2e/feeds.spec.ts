// Following a website's feed and reading its posts, against a small website run by the test.
import { createServer, type Server } from 'node:http'
import { expect, test } from './fixtures.ts'

let site: Server
let base = ''
const name = `Test Blog ${Date.now().toString(36)}`

test.beforeAll(async () => {
  const feed = `<?xml version="1.0"?><rss version="2.0"><channel><title>${name}</title><link>https://blog.test</link>
    <item><title>Hello feeds</title><guid>p1</guid><link>https://blog.test/p1</link><pubDate>Mon, 01 Jan 2030 09:00:00 GMT</pubDate>
      <description>&lt;p&gt;First &lt;b&gt;post&lt;/b&gt;&lt;/p&gt;&lt;script&gt;alert("feed script")&lt;/script&gt;</description></item>
    <item><title>Second thoughts</title><guid>p2</guid><pubDate>Tue, 02 Jan 2030 09:00:00 GMT</pubDate><description>More</description></item>
  </channel></rss>`
  site = createServer((request, response) => {
    if (request.url === '/feed.xml') return response.writeHead(200, { 'content-type': 'application/rss+xml' }).end(feed)
    // The home page announces its feed, as real sites do.
    response
      .writeHead(200, { 'content-type': 'text/html' })
      .end('<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>')
  })
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(site.address() as { port: number }).port}`
})
test.afterAll(() => site.close())

test('follows a website, reads safely, stars, searches, sets auto-delete, and moves feeds by OPML', async ({
  page,
}) => {
  await page.goto('/feeds')
  await page.getByRole('link', { name: 'Follow a feed' }).click() // following is in Settings → Feeds
  await expect(page).toHaveURL(/\/settings\/feeds$/)
  await page.getByLabel('Feed or website address').fill('https://')
  await page.getByRole('button', { name: 'Follow', exact: true }).click()
  await expect(page.getByLabel('Feed or website address')).toBeFocused() // the browser refused the incomplete address

  // Pasting the website's address is enough: Nexus finds the feed it announces.
  await page.getByLabel('Feed or website address').fill(base)
  await page.getByRole('button', { name: 'Follow', exact: true }).click()
  const followed = page.getByRole('list', { name: 'Followed feeds' })
  await expect(followed.getByText(name)).toBeVisible()

  // Following it again is refused, with the reason.
  await page.getByLabel('Feed or website address').fill(`${base}/feed.xml`)
  await page.getByRole('button', { name: 'Follow', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('already follow')

  await page.goto('/feeds')
  const feeds = page.getByRole('list', { name: 'Your feeds' })
  await expect(feeds.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Mailboxes' }).getByRole('link', { name: /^Feeds/ })).toContainText(
    '2',
  )

  await page.getByRole('button', { name: /Hello feeds/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Hello feeds' })).toBeVisible()
  const body = page.frameLocator('iframe[title="Message content"]')
  await expect(body.locator('b')).toHaveText('post')
  await expect(body.locator('script')).toHaveCount(0) // and the fixture fails the test if the alert ran
  await expect(page.getByRole('link', { name: /Open original/ })).toHaveAttribute('href', 'https://blog.test/p1')
  await expect(page.getByRole('navigation', { name: 'Mailboxes' }).getByRole('link', { name: /^Feeds/ })).toContainText(
    '1',
  )

  await feeds.getByRole('button', { name: new RegExp(`^${name}`) }).click()
  await expect(page.getByRole('button', { name: /Second thoughts/ })).toBeVisible()

  // Star a post, and find it under Starred.
  await page.getByRole('button', { name: /Second thoughts/ }).click()
  await page.getByRole('button', { name: 'Star', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Starred', exact: true, pressed: true })).toBeVisible()
  await feeds.getByRole('button', { name: 'Starred', exact: true }).click()
  await expect(page.getByRole('button', { name: /Second thoughts/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Hello feeds/ })).toBeHidden()

  // Search looks through titles and text.
  await feeds.getByRole('button', { name: 'All feeds' }).click()
  await page.getByLabel('Search posts').fill('first post')
  await expect(page.getByRole('button', { name: /Hello feeds/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Second thoughts/ })).toBeHidden()
  await page.getByLabel('Search posts').fill('')

  // Deleting old posts is off until chosen.
  await page.getByRole('link', { name: 'Manage feeds' }).click()
  const deleteAfter = page.getByLabel('Delete posts after')
  await expect(deleteAfter).toHaveValue('')
  await deleteAfter.selectOption({ label: '1 month' })
  await page.reload()
  await expect(page.getByLabel('Delete posts after')).toHaveValue('30')
  await page.getByLabel('Delete posts after').selectOption({ label: 'Never' })

  // The feed list can leave as an OPML file…
  await expect(page.getByRole('link', { name: 'Export OPML' })).toHaveAttribute('href', '/api/feeds/export.opml')
  const opml = await (await page.request.get('/api/feeds/export.opml')).text()
  expect(opml).toContain(`xmlUrl="${base}/feed.xml"`)

  await page.getByRole('button', { name: `Unfollow ${name}` }).click()
  await expect(followed.getByText(name)).toBeHidden()

  // …and come back from one.
  const picker = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import OPML' }).click()
  await (await picker).setFiles({ name: 'feeds.opml', mimeType: 'text/x-opml', buffer: Buffer.from(opml) })
  await expect(page.getByRole('status')).toContainText('Following 1 new feed')
  await expect(followed.getByText(name)).toBeVisible()
  await page.getByRole('button', { name: `Unfollow ${name}` }).click()
  await expect(followed.getByText(name)).toBeHidden()
  await page.goto('/feeds')
  await expect(page.getByRole('button', { name: /Hello feeds/ })).toBeHidden()
})
