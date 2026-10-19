import { describe, expect, it } from 'vitest'
import { applyRules, classify, isBlocked, isSpam, nothingChanged } from './sorting.ts'
import { extractEvent, fromIcs } from './events.ts'
import { makePreview } from './parse.ts'

const base = { fromEmail: 'sara@okafor.dev', subject: 'Lunch?', isMailingList: false, isAutomated: false, hasEvent: false }

describe('classify', () => {
  it('puts people first', () => expect(classify(base)).toBe('people'))
  it('spots travel by event or subject', () => {
    expect(classify({ ...base, hasEvent: true })).toBe('travel')
    expect(classify({ ...base, subject: 'Your e-ticket for KL605' })).toBe('travel')
  })
  it('treats automated senders as notifications, even with list headers', () => {
    expect(classify({ ...base, fromEmail: 'notifications@github.com', isMailingList: true })).toBe('notifications')
    expect(classify({ ...base, fromEmail: 'no-reply@bank.example' })).toBe('notifications')
    expect(classify({ ...base, isAutomated: true })).toBe('notifications')
  })
  it('treats list mail from a person-like sender as a newsletter', () => {
    expect(classify({ ...base, fromEmail: 'newsletter@selfh.st', isMailingList: true })).toBe('newsletters')
  })
})

describe('applyRules', () => {
  const message = { fromEmail: 'billing@hetzner.com', fromName: 'Hetzner', to: ['ali@azam.email'], subject: 'Invoice R0034871', text: 'Amount due' }
  it('applies every matching rule, case-insensitively', () => {
    const outcome = applyRules(message, [
      { field: 'subject', contains: 'INVOICE', action: 'label', value: 'Receipts', enabled: true },
      { field: 'from', contains: 'hetzner', action: 'mark-read', value: null, enabled: true },
      { field: 'from', contains: 'hetzner', action: 'move', value: 'archive', enabled: false },
      { field: 'body', contains: 'nope', action: 'spam', value: null, enabled: true },
    ])
    expect(outcome).toEqual({ labels: ['Receipts'], markRead: true, spam: false })
  })
})

describe('spam', () => {
  it('matches blocked addresses and domains, including subdomains', () => {
    expect(isBlocked('a@spam.example', ['spam.example'])).toBe(true)
    expect(isBlocked('a@mail.spam.example', ['spam.example'])).toBe(true)
    expect(isBlocked('a@notspam.example', ['spam.example'])).toBe(false)
    expect(isBlocked('promo@shop.example', ['promo@shop.example'])).toBe(true)
    expect(isBlocked('hello@shop.example', ['promo@shop.example'])).toBe(false)
  })
  it('prefers the score over the flag', () => {
    expect(isSpam({ fromEmail: 'a@b.c', spamFlag: true, spamScore: 2 }, [], 5)).toBe(false)
    expect(isSpam({ fromEmail: 'a@b.c', spamFlag: false, spamScore: 7.5 }, [], 5)).toBe(true)
    expect(isSpam({ fromEmail: 'a@b.c', spamFlag: true, spamScore: null }, [], 5)).toBe(true)
  })
})

describe('events', () => {
  it('reads a schema.org flight booking', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@context': 'http://schema.org', '@type': 'FlightReservation', reservationNumber: 'QX7T2M', airplaneSeat: '32A',
      reservationFor: { '@type': 'Flight', flightNumber: '605', airline: { iataCode: 'KL' },
        departureAirport: { name: 'Amsterdam', iataCode: 'AMS' }, arrivalAirport: { name: 'San Francisco', iataCode: 'SFO' },
        departureTime: '2026-11-14T10:25:00+01:00', arrivalTime: '2026-11-14T12:40:00-08:00' },
    })}</script>`
    expect(extractEvent({ html, icsTexts: [] })).toEqual({
      title: 'KL605 Amsterdam → San Francisco', start: '2026-11-14T10:25:00+01:00', end: '2026-11-14T12:40:00-08:00',
      location: 'Amsterdam', detail: 'Seat 32A · Booking QX7T2M',
    })
  })

  it('reads an .ics invite with folded lines', () => {
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Team sync\\, weekly\r\nDTSTART:20261020T090000Z\r\nDTEND:20261020T093000Z\r\nLOCATION:Room\r\n  4\r\nEND:VEVENT\r\nEND:VCALENDAR'
    expect(fromIcs(ics)).toEqual({ title: 'Team sync, weekly', start: '2026-10-20T09:00:00Z', end: '2026-10-20T09:30:00Z', location: 'Room 4' })
  })

  it('ignores broken JSON-LD', () => {
    expect(extractEvent({ html: '<script type="application/ld+json">{oops</script>', icsTexts: [] })).toBeNull()
  })
})

describe('makePreview', () => {
  it('strips markup and styles', () => {
    expect(makePreview('<style>p{}</style><p>Hello&nbsp;<b>there</b></p>')).toBe('Hello there')
    expect(makePreview('<head><title>Ignore me</title></head><h1>Your trip</h1><p>Tom &amp; Jerry &lt;3</p>')).toBe('Your trip Tom & Jerry <3')
  })
})

describe('nothingChanged (sync shortcut)', () => {
  const saved = { highestModseq: 100n, lastExists: 50 }
  it('skips only when counter, count and new mail all match', () => {
    expect(nothingChanged(saved, { highestModseq: 100n, exists: 50 }, 0)).toBe(true)
    expect(nothingChanged(saved, { highestModseq: 101n, exists: 50 }, 0)).toBe(false) // a flag changed
    expect(nothingChanged(saved, { highestModseq: 100n, exists: 49 }, 0)).toBe(false) // a message was deleted
    expect(nothingChanged(saved, { highestModseq: 100n, exists: 50 }, 1)).toBe(false) // new mail
  })
  it('never skips on servers without CONDSTORE or on the first sync', () => {
    expect(nothingChanged(saved, { highestModseq: null, exists: 50 }, 0)).toBe(false)
    expect(nothingChanged({ highestModseq: null, lastExists: null }, { highestModseq: 100n, exists: 50 }, 0)).toBe(false)
  })
})
