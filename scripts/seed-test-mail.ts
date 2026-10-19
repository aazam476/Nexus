// Development helper: sends a realistic mix of mail to a local GreenMail server
// (docker-compose.dev.yml) so the smart inbox has something to sort.
//   node scripts/seed-test-mail.ts ali@nexus.test
import nodemailer from 'nodemailer'

const to = process.argv[2] ?? 'ali@nexus.test'
const smtp = nodemailer.createTransport({ host: 'localhost', port: 3025, secure: false, ignoreTLS: true })

const flight = {
  '@context': 'http://schema.org',
  '@type': 'FlightReservation',
  reservationNumber: 'QX7T2M',
  airplaneSeat: '32A',
  reservationFor: {
    '@type': 'Flight',
    flightNumber: '605',
    airline: { iataCode: 'KL' },
    departureAirport: { name: 'Amsterdam', iataCode: 'AMS' },
    arrivalAirport: { name: 'San Francisco', iataCode: 'SFO' },
    departureTime: '2026-11-14T10:25:00+01:00',
    arrivalTime: '2026-11-14T12:40:00-08:00',
  },
}

const messages = [
  { from: 'Sara Okafor <sara@okafor.dev>', subject: 'Re: Paperless tags for the tax folder', html: '<p>Hi Ali,</p><p>I tried your rule set and it caught everything except the <b>2024 Hetzner invoices</b>.</p>' },
  {
    from: 'KLM Royal Dutch Airlines <noreply@klm.com>',
    subject: 'Booking confirmed AMS → SFO, 14 Nov',
    html: `<script type="application/ld+json">${JSON.stringify(flight)}</script><h1>Your trip to San Francisco</h1><p>Booking code <b>QX7T2M</b></p><img src="https://example.com/banner.png">`,
  },
  { from: 'selfh.st <newsletter@selfh.st>', subject: 'This week in self-hosting', html: '<h2>18 new releases</h2>', headers: { 'List-Unsubscribe': '<mailto:unsub@selfh.st>' } },
  { from: 'GitHub <notifications@github.com>', subject: '[nexus] PR #14 ready for review', text: 'jdoe requested your review.', headers: { 'List-Id': 'nexus.github.com' } },
  { from: 'Crypto Winner <win@claim-prize.biz>', subject: 'You won 2.5 BTC', text: 'Claim now!', headers: { 'X-Spam-Flag': 'YES', 'X-Spam-Status': 'Yes, score=12.4' } },
  {
    from: 'Hetzner Online <billing@hetzner.com>',
    subject: 'Invoice R0034871 for October',
    text: 'Amount due €14.28.',
    attachments: [{ filename: 'R0034871.txt', content: 'Invoice R0034871\nTotal: €14.28\n' }],
  },
]

for (const message of messages) {
  await smtp.sendMail({ to, ...message })
  console.log(`sent: ${message.subject}`)
}
smtp.close()
