// Finds a calendar event in an email: a flight, hotel or ticket booking (schema.org JSON-LD that
// airlines and booking sites embed), or an attached .ics invite.
import { zonedTimeToUtc } from './timezones.ts'

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
  // Each <script type="application/ld+json">…</script>; the capture is the JSON between the tags.
  for (const match of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(match[1])
      const items = Array.isArray(data) ? data : (data['@graph'] ?? [data])
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
    const number = `${flight.airline?.iataCode ?? ''}${flight.flightNumber ?? ''}`.trim() // e.g. "KL605"
    const route = `${from.name ?? from.iataCode ?? '?'} → ${to.name ?? to.iataCode ?? '?'}` // e.g. "Oslo → LIS"
    const seat = item.airplaneSeat ? `Seat ${item.airplaneSeat}` : undefined
    return {
      title: number ? `${number} ${route}` : route,
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
  // Lines starting with a space or tab continue the line before ("folding"); join them back first.
  const lines = ics.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  const start = lines.findIndex((l) => l === 'BEGIN:VEVENT')
  if (start === -1) return null
  // Each line is NAME;PARAM=…;PARAM=…:VALUE, e.g. "DTSTART;TZID=Europe/Oslo:20301114T102500".
  const fields = new Map<string, { value: string; params: string }>()
  for (const line of lines.slice(start + 1)) {
    if (line === 'END:VEVENT') break
    const colon = line.indexOf(':')
    const [name, ...params] = line.slice(0, colon).split(';')
    const key = name.toUpperCase()
    if (!fields.has(key)) fields.set(key, { value: line.slice(colon + 1), params: params.join(';') })
  }
  const begin = icsDate(fields.get('DTSTART'))
  if (!begin) return null
  const unescape = (value?: string) => value?.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1')
  return {
    title: unescape(fields.get('SUMMARY')?.value) ?? 'Event',
    start: begin,
    end: icsDate(fields.get('DTEND')) ?? begin,
    location: unescape(fields.get('LOCATION')?.value),
  }
}

// Invite times come in three kinds:
//   20301114T102500Z                    a moment in UTC ("Z")
//   TZID=Europe/Oslo:20301114T102500    a clock time in a named time zone
//   20301114T102500 or 20301114         "floating": the same clock time wherever you are (all-day
//                                       events too). Returned without "Z", so browsers show it as
//                                       their own local time.
function icsDate(field?: { value: string; params: string }): string | undefined {
  // Year, month, day, then optionally "T" with hour, minute, second and an optional "Z" (UTC).
  const m = field?.value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/)
  if (!m) return undefined
  const [, y, mo, d, h = '00', mi = '00', s = '00', utc] = m
  const local = `${y}-${mo}-${d}T${h}:${mi}:${s}`
  if (utc) return `${local}Z`

  const zone = field!.params.match(/TZID=([^;]+)/i)?.[1]?.replace(/^"|"$/g, '') // the name may be in quotes
  if (!zone) return local // floating
  const time = { year: +y, month: +mo, day: +d, hour: +h, minute: +mi, second: +s }
  // A zone we can't recognise is read as UTC: better than dropping the event.
  return zonedTimeToUtc(time, zone) ?? `${local}Z`
}
