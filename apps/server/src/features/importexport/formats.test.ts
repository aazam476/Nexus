import { describe, expect, it } from 'vitest'
import { parseVcards, toVcards } from '../contacts/vcard.ts'
import { splitMbox, toMbox } from './mbox.ts'

describe('mbox', () => {
  it('round-trips messages, escaping body lines that start with "From "', () => {
    const a = Buffer.from('Subject: one\r\n\r\nFrom here on, hi\r\n>From quoted\r\n')
    const b = Buffer.from('Subject: two\r\n\r\nbye\r\n')
    const file = toMbox([
      { raw: a, fromEmail: 'a@x.y', date: new Date('2026-10-19T09:42:00Z') },
      { raw: b, fromEmail: 'b@x.y', date: new Date('2026-10-19T09:43:00Z') },
    ])
    expect(file.toString()).toContain('From a@x.y Mon Oct 19 09:42:00 2026\n')
    expect(file.toString()).toContain('>From here on')
    const back = splitMbox(file)
    expect(back.map((m) => m.toString())).toEqual([a.toString(), b.toString()])
  })

  it('keeps non-UTF-8 bytes intact', () => {
    const latin = Buffer.from([0x53, 0x3a, 0x20, 0xe9, 0x0d, 0x0a, 0x0d, 0x0a, 0xff, 0x0d, 0x0a]) // "S: é\r\n\r\n\xff\r\n" in latin1
    const [back] = splitMbox(toMbox([{ raw: latin, fromEmail: 'a@b.c', date: new Date() }]))
    expect([...back]).toEqual([...latin])
  })
})

describe('vCard', () => {
  it('reads common fields, folded lines and grouped properties', () => {
    const card = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Sara Oka\r\n for\r\nitem1.EMAIL;TYPE=work:Sara@Okafor.dev\r\nEMAIL:s@proton.me\r\nTEL:+49 151\r\nORG:Okafor Labs;R&D\r\nEND:VCARD\r\nBEGIN:VCARD\r\nFN:No email\r\nEND:VCARD'
    expect(parseVcards(card)).toEqual([{ name: 'Sara Okafor', emails: ['sara@okafor.dev', 's@proton.me'], phone: '+49 151', company: 'Okafor Labs' }])
  })

  it('round-trips, escaping commas', () => {
    const contacts = [{ name: 'Doe, Jane', emails: ['jane@doe.org'], company: 'ACME' }]
    expect(parseVcards(toVcards(contacts))).toEqual(contacts)
  })
})
