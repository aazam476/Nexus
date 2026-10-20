import { describe, expect, it } from 'vitest'
import { completeMultiline, unstuff } from './pop3.ts'

const reply = (s: string) => Buffer.from(s, 'latin1')

describe('POP3 multi-line replies', () => {
  it('keeps lines that start with a dot, removing only the stuffed dot', () => {
    const done = completeMultiline(reply('+OK 40 octets\r\nline one\r\n..starts with a dot\r\n...two\r\nend\r\n.\r\n'))
    expect(done?.body.toString()).toBe('line one\r\n.starts with a dot\r\n..two\r\nend\r\n')
  })

  it('waits until the terminating line has arrived', () => {
    expect(completeMultiline(reply('+OK\r\nline one\r\n.start'))).toBeNull()
    expect(completeMultiline(reply('+OK\r\nline one\r\n'))).toBeNull()
  })

  it('handles an empty reply and keeps what follows for the next one', () => {
    const done = completeMultiline(reply('+OK\r\n.\r\n+OK next'))
    expect(done?.body.length).toBe(0)
    expect(done?.rest.toString()).toBe('+OK next')
  })

  it('leaves 8-bit bytes alone', () => {
    expect([...unstuff(Buffer.from([0x2e, 0x2e, 0xe9, 0xff]))]).toEqual([0x2e, 0xe9, 0xff])
  })
})
