import { describe, expect, it } from 'vitest'
import { parseRaw } from './parse.ts'

const mail = (headers: string, body = 'hi') =>
  Buffer.from(`From: Sender <s@example.com>\r\nTo: a@b.c\r\nSubject: Test\r\n${headers}\r\n${body}\r\n`)

describe('parseRaw', () => {
  it('spots mailing lists from any List-* header', async () => {
    expect((await parseRaw(mail('List-Unsubscribe: <mailto:u@x.y>\r\n'))).isMailingList).toBe(true)
    expect((await parseRaw(mail('List-Id: <news.x.y>\r\n'))).isMailingList).toBe(true)
    expect((await parseRaw(mail(''))).isMailingList).toBe(false)
  })

  it('reads spam scores from SpamAssassin and Rspamd headers', async () => {
    expect((await parseRaw(mail('X-Spam-Status: Yes, score=12.4 required=5\r\n'))).spamScore).toBe(12.4)
    expect((await parseRaw(mail('X-Rspamd-Score: 3.1\r\n'))).spamScore).toBe(3.1)
    expect((await parseRaw(mail('X-Spam-Flag: YES\r\n'))).spamFlag).toBe(true)
  })

  it('detects PGP and S/MIME', async () => {
    expect((await parseRaw(mail('', '-----BEGIN PGP MESSAGE-----\r\nabc\r\n-----END PGP MESSAGE-----'))).security).toBe(
      'pgp-encrypted',
    )
    expect(
      (
        await parseRaw(
          mail(
            'MIME-Version: 1.0\r\nContent-Type: multipart/signed; protocol="application/pkcs7-signature"; boundary=x\r\n',
            '--x\r\n\r\nhi\r\n--x--',
          ),
        )
      ).security,
    ).toBe('smime-signed')
    expect(
      (
        await parseRaw(
          mail('MIME-Version: 1.0\r\nContent-Type: application/pkcs7-mime; smime-type=enveloped-data\r\n', 'AAAA'),
        )
      ).security,
    ).toBe('smime-encrypted')
  })

  it('treats Auto-Submitted mail as automated, unless it says "no"', async () => {
    expect((await parseRaw(mail('Auto-Submitted: auto-generated\r\n'))).isAutomated).toBe(true)
    expect((await parseRaw(mail('Auto-Submitted: no\r\n'))).isAutomated).toBe(false)
  })
})
