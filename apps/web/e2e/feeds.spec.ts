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

test('follows a website, reads a post safely, filters and unfollows', async ({ page }) => {
  await page.goto('/feeds')
  await page.getByLabel('Feed or website address').fill('https://')
  await page.getByRole('button', { name: 'Follow', exact: true }).click()
  await expect(page.getByLabel('Feed or website address')).toBeFocused() // the browser refused the incomplete address

  // Pasting the website's address is enough: Nexus finds the feed it announces.
  await page.getByLabel('Feed or website address').fill(base)
  await page.getByRole('button', { name: 'Follow', exact: true }).click()
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

  // Following it again is refused, with the reason.
  await page.getByLabel('Feed or website address').fill(`${base}/feed.xml`)
  await page.getByRole('button', { name: 'Follow', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('already follow')

  await feeds.getByRole('button', { name: new RegExp(`^${name}`) }).click()
  await expect(page.getByRole('button', { name: /Second thoughts/ })).toBeVisible()
  await page.getByRole('button', { name: `Unfollow ${name}` }).click()
  await expect(feeds.getByRole('button', { name: new RegExp(`^${name}`) })).toBeHidden()
  await expect(page.getByRole('button', { name: /Hello feeds/ })).toBeHidden()
})
