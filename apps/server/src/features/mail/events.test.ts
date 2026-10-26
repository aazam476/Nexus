import { describe, expect, it } from 'vitest'
import { extractEvent, fromIcs } from './events.ts'

const jsonLd = (data: unknown) => `<html><script type="application/ld+json">${JSON.stringify(data)}</script></html>`

describe('bookings in email (schema.org JSON-LD)', () => {
  it('reads a flight, with seat and booking code', () => {
    const html = jsonLd({
      '@type': 'FlightReservation',
      reservationNumber: 'K7RW2P',
      airplaneSeat: '14C',
      reservationFor: {
        flightNumber: '318',
        airline: { iataCode: 'AR' },
        departureAirport: { name: 'Stockholm', iataCode: 'ARN' },
        arrivalAirport: { iataCode: 'LIS' },
        departureTime: '2030-11-21T07:40:00+01:00',
        arrivalTime: '2030-11-21T10:35:00Z',
      },
    })
    expect(extractEvent({ html, icsTexts: [] })).toEqual({
      title: 'AR318 Stockholm → LIS',
      start: '2030-11-21T07:40:00+01:00',
      end: '2030-11-21T10:35:00Z',
      location: 'Stockholm',
      detail: 'Seat 14C · Booking K7RW2P',
    })
  })

  it('reads a hotel stay and a ticketed event', () => {
    const hotel = jsonLd({
      '@type': 'LodgingReservation',
      reservationNumber: 'H1',
      checkinTime: '2030-06-01T15:00:00Z',
      checkoutTime: '2030-06-03T11:00:00Z',
      reservationFor: { name: 'Hotel Azul', address: { streetAddress: 'Rua 1' } },
    })
    expect(extractEvent({ html: hotel, icsTexts: [] })).toEqual({
      title: 'Stay at Hotel Azul',
      start: '2030-06-01T15:00:00Z',
      end: '2030-06-03T11:00:00Z',
      location: 'Rua 1',
      detail: 'Booking H1',
    })

    const concert = jsonLd({
      '@type': 'EventReservation',
      reservationFor: { name: 'Jazz night', startDate: '2030-07-01T20:00:00Z', location: { name: 'Blue Hall' } },
    })
    expect(extractEvent({ html: concert, icsTexts: [] })).toEqual({
      title: 'Jazz night',
      start: '2030-07-01T20:00:00Z',
      end: '2030-07-01T20:00:00Z',
      location: 'Blue Hall',
      detail: undefined,
    })
  })

  it('finds a booking inside a @graph list, and skips broken or unrelated blocks', () => {
    const html =
      '<script type="application/ld+json">{not json</script>' +
      jsonLd({
        '@graph': [
          { '@type': 'Organization' },
          { '@type': 'EventReservation', reservationFor: { name: 'Talk', startDate: '2030-01-01T09:00:00Z' } },
        ],
      })
    expect(extractEvent({ html, icsTexts: [] })?.title).toBe('Talk')
    expect(
      extractEvent({ html: jsonLd({ '@type': 'FlightReservation', reservationFor: {} }), icsTexts: [] }),
    ).toBeNull()
    expect(extractEvent({ html: null, icsTexts: [] })).toBeNull()
  })
})

describe('calendar invites (.ics)', () => {
  const invite = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'SUMMARY:Planning\\, round 2',
    'DTSTART;TZID=Europe/Oslo:20301114T102500',
    'DTEND:20301114T113000Z',
    'LOCATION:Room 4',
    ' B',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  it('reads the summary, times and location, undoing escaping and line folding', () => {
    expect(fromIcs(invite)).toEqual({
      title: 'Planning, round 2',
      start: '2030-11-14T10:25:00Z',
      end: '2030-11-14T11:30:00Z',
      location: 'Room 4B',
    })
  })

  it('handles all-day events, and is used when the email has no JSON-LD booking', () => {
    const allDay = 'BEGIN:VEVENT\nSUMMARY:Holiday\nDTSTART;VALUE=DATE:20300704\nEND:VEVENT'
    expect(extractEvent({ html: '<p>no booking</p>', icsTexts: [allDay] })).toEqual({
      title: 'Holiday',
      start: '2030-07-04T00:00:00Z',
      end: '2030-07-04T00:00:00Z',
      location: undefined,
    })
  })

  it('ignores files without an event or a start time', () => {
    expect(fromIcs('BEGIN:VCALENDAR\nEND:VCALENDAR')).toBeNull()
    expect(fromIcs('BEGIN:VEVENT\nSUMMARY:No time\nEND:VEVENT')).toBeNull()
  })
})
