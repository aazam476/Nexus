// Small helpers for working with raw MIME text. Kept separate so they are easy to test.
import { createHash } from 'node:crypto'

export interface InlineImage {
  cid: string
  filename: string
  contentType: string
  content: Buffer
}

// The composer embeds pasted images as data: URLs. Mail clients expect them as attachments
// referenced by cid:, so swap each one out.
export function extractInlineImages(html: string): { html: string; images: InlineImage[] } {
  const images: InlineImage[] = []
  const rewritten = html.replace(/src="data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)"/gi, (_match, contentType: string, base64: string) => {
    const content = Buffer.from(base64.replace(/\s/g, ''), 'base64')
    const cid = `${createHash('sha256').update(content).digest('hex').slice(0, 16)}@nexus`
    if (!images.some((i) => i.cid === cid)) {
      images.push({ cid, filename: `image-${images.length + 1}.${contentType.split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg')}`, contentType, content })
    }
    return `src="cid:${cid}"`
  })
  return { html: rewritten, images }
}

// Splits a raw message at the first blank line.
export function splitHeaders(raw: Buffer): { headers: string; body: Buffer } {
  const text = raw.toString('latin1')
  const end = text.search(/\r?\n\r?\n/)
  if (end === -1) return { headers: text, body: Buffer.alloc(0) }
  const separator = text.slice(end).match(/^\r?\n\r?\n/)![0]
  return { headers: text.slice(0, end), body: raw.subarray(Buffer.byteLength(text.slice(0, end + separator.length), 'latin1')) }
}

// Header lines (with their folded continuation lines), grouped per header.
export function headerFields(headers: string): string[] {
  return headers.split(/\r?\n(?![ \t])/).filter(Boolean)
}

const contentHeader = /^(content-[a-z-]+|mime-version):/i

// The MIME "entity": only the Content-* headers plus the body. This is what S/MIME signs or encrypts.
export function mimeEntity(raw: Buffer): Buffer {
  const { headers, body } = splitHeaders(raw)
  const content = headerFields(headers).filter((h) => contentHeader.test(h) && !/^mime-version:/i.test(h))
  return Buffer.concat([Buffer.from(content.join('\r\n') + '\r\n\r\n', 'latin1'), body])
}

// Puts the envelope headers (From, To, Subject…) back on top of a signed or encrypted entity.
export function rewrap(original: Buffer, entity: Buffer): Buffer {
  const outer = headerFields(splitHeaders(original).headers).filter((h) => !contentHeader.test(h))
  return Buffer.concat([Buffer.from(outer.join('\r\n') + '\r\n', 'latin1'), entity])
}
