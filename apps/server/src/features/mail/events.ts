// Finds a calendar event in an email: a flight, hotel or ticket booking (schema.org JSON-LD that
// airlines and booking sites embed), or an attached .ics invite.

export interface CalendarEvent {
  title: string
  start: string // ISO date-time
  end: string
  location?: string
  detail?: string
}

export function extractEvent({ html, icsTexts }: { html: string | null; icsTexts: string[] }): CalendarEvent | null {
  for (const block of jsonLdBlocks(html ?? '')) {
    const event = fromSchemaOrg(block)
    if (event) return event
  }
  for (const ics of icsTexts) {
    const event = fromIcs(ics)
    if (event) return event
  }
  return null
}

function jsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = []
  for (const match of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(match[1])
      const items = Array.isArray(data) ? data : data['@graph'] ?? [data]
      blocks.push(...items)
    } catch {
      // Broken JSON-LD in a marketing email: ignore it.
    }
  }
  return blocks
}

// The schema.org shapes are deep and loosely typed, so they are read as `any`.
type Loose = any

function fromSchemaOrg(item: Loose): CalendarEvent | null {
  const type = String(item?.['@type'] ?? '')
  const booking = item?.reservationNumber ? `Booking ${item.reservationNumber}` : undefined

  if (type === 'FlightReservation') {
    const flight = item.reservationFor ?? {}
    const from = flight.departureAirport ?? {}
    const to = flight.arrivalAirport ?? {}
    if (!flight.departureTime) return null
    const number = `${flight.airline?.iataCode ?? ''}${flight.flightNumber ?? ''}`.trim()
    const seat = item.airplaneSeat ? `Seat ${item.airplaneSeat}` : undefined
    return {
      title: `${number ? number + ' ' : ''}${from.name ?? from.iataCode ?? '?'} → ${to.name ?? to.iataCode ?? '?'}`,
      start: flight.departureTime,
      end: flight.arrivalTime ?? flight.departureTime,
      location: from.name ?? from.iataCode,
      detail: [seat, booking].filter(Boolean).join(' · ') || undefined,
    }
  }

  if (type === 'LodgingReservation' && item.checkinTime) {
    return {
      title: `Stay at ${item.reservationFor?.name ?? 'hotel'}`,
      start: item.checkinTime,
      end: item.checkoutTime ?? item.checkinTime,
      location: item.reservationFor?.address?.streetAddress ?? item.reservationFor?.name,
      detail: booking,
    }
  }

  if (type === 'EventReservation' && item.reservationFor?.startDate) {
    const event = item.reservationFor
    return {
      title: event.name ?? 'Event',
      start: event.startDate,
      end: event.endDate ?? event.startDate,
      location: event.location?.name,
      detail: booking,
    }
  }
  return null
}

// Minimal iCalendar reader: the first VEVENT's summary, times and location.
export function fromIcs(ics: string): CalendarEvent | null {
  const lines = ics.replace(/\r?\n[ \t]/g, '').split(/\r?\n/) // undo line folding
  const start = lines.findIndex((l) => l === 'BEGIN:VEVENT')
  if (start === -1) return null
  const fields = new Map<string, string>()
  for (const line of lines.slice(start + 1)) {
    if (line === 'END:VEVENT') break
    const colon = line.indexOf(':')
    const name = line.slice(0, colon).split(';')[0].toUpperCase()
    if (!fields.has(name)) fields.set(name, line.slice(colon + 1))
  }
  const begin = icsDate(fields.get('DTSTART'))
  if (!begin) return null
  const unescape = (value?: string) => value?.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1')
  return {
    title: unescape(fields.get('SUMMARY')) ?? 'Event',
    start: begin,
    end: icsDate(fields.get('DTEND')) ?? begin,
    location: unescape(fields.get('LOCATION')),
  }
}

// 20261114T102500Z, 20261114T102500 (floating) or 20261114 (all day).
function icsDate(value?: string): string | undefined {
  const m = value?.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/)
  if (!m) return undefined
  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m
  // shortcut: floating and TZID times are read as UTC; add a timezone database if invites show at the wrong hour.
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`
}
