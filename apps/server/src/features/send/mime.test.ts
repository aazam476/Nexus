import { describe, expect, it } from 'vitest'
import { extractInlineImages, mimeEntity, rewrap, splitHeaders } from './mime.ts'

describe('extractInlineImages', () => {
  it('replaces data: images with cid: references, once per distinct image', () => {
    const png = Buffer.from('fake-png').toString('base64')
    const { html, images } = extractInlineImages(
      `<p>a</p><img src="data:image/png;base64,${png}" alt="x"><img src="data:image/png;base64,${png}">`,
    )
    expect(images).toHaveLength(1)
    expect(images[0].content.toString()).toBe('fake-png')
    expect(html).toBe(`<p>a</p><img src="cid:${images[0].cid}" alt="x"><img src="cid:${images[0].cid}">`)
  })

  it('leaves remote and non-image sources alone', () => {
    const input = '<img src="https://x/y.png"><a href="data:text/html;base64,AAAA">x</a>'
    expect(extractInlineImages(input)).toEqual({ html: input, images: [] })
  })
})

const message = Buffer.from(
  'From: Ali <ali@azam.email>\r\nTo: sara@okafor.dev\r\nSubject: Hi\r\n  there\r\nMIME-Version: 1.0\r\nContent-Type: text/plain;\r\n charset=utf-8\r\nContent-Transfer-Encoding: 7bit\r\n\r\nHello\r\n',
)

describe('MIME entity helpers', () => {
  it('splits headers from body', () => {
    expect(splitHeaders(message).body.toString()).toBe('Hello\r\n')
  })

  it('keeps only content headers (with folded lines) in the entity', () => {
    expect(mimeEntity(message).toString()).toBe(
      'Content-Type: text/plain;\r\n charset=utf-8\r\nContent-Transfer-Encoding: 7bit\r\n\r\nHello\r\n',
    )
  })

  it('puts envelope headers back on top of a new entity', () => {
    const signed = Buffer.from(
      'MIME-Version: 1.0\r\nContent-Type: multipart/signed; protocol="application/pkcs7-signature"\r\n\r\n...',
    )
    expect(rewrap(message, signed).toString()).toBe(
      'From: Ali <ali@azam.email>\r\nTo: sara@okafor.dev\r\nSubject: Hi\r\n  there\r\nMIME-Version: 1.0\r\nContent-Type: multipart/signed; protocol="application/pkcs7-signature"\r\n\r\n...',
    )
  })
})
