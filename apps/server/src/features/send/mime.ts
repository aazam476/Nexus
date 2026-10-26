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
// Matches src="data:image/png;base64,iVBOR..." and captures the type ("image/png") and the base64 data.
const DATA_IMAGE = /src="data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)"/gi

export function extractInlineImages(html: string): { html: string; images: InlineImage[] } {
  const images: InlineImage[] = []
  const rewritten = html.replace(DATA_IMAGE, (_match, contentType: string, base64: string) => {
    const content = Buffer.from(base64.replace(/\s/g, ''), 'base64')
    // Named after the image's own bytes, so the same image pasted twice is attached once.
    const cid = `${createHash('sha256').update(content).digest('hex').slice(0, 16)}@nexus`
    if (!images.some((image) => image.cid === cid)) {
      images.push({ cid, filename: `image-${images.length + 1}.${extensionFor(contentType)}`, contentType, content })
    }
    return `src="cid:${cid}"`
  })
  return { html: rewritten, images }
}

// "image/jpeg" → "jpg", "image/svg+xml" → "svg", "image/png" → "png"
function extensionFor(contentType: string): string {
  const subtype = contentType.split('/')[1]
  if (subtype === 'jpeg') return 'jpg'
  if (subtype === 'svg+xml') return 'svg'
  return subtype
}

// Splits a raw message into its headers and its body, which are separated by the first blank line.
export function splitHeaders(raw: Buffer): { headers: string; body: Buffer } {
  // latin1 turns each byte into one character, so character positions are byte positions too.
  const text = raw.toString('latin1')
  const blankLine = text.match(/\r?\n\r?\n/) // "\n\n" or "\r\n\r\n"
  if (!blankLine || blankLine.index === undefined) return { headers: text, body: Buffer.alloc(0) }
  return {
    headers: text.slice(0, blankLine.index),
    body: raw.subarray(blankLine.index + blankLine[0].length),
  }
}

// One entry per header. A long header continues on lines that start with a space or tab
// ("folding"), so only split at line breaks NOT followed by a space or tab ("(?![ \t])").
export function headerFields(headers: string): string[] {
  return headers.split(/\r?\n(?![ \t])/).filter(Boolean)
}

// Headers that describe the content (Content-Type, Content-Transfer-Encoding…) rather than the envelope.
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
