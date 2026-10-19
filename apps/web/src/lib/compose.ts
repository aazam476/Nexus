// Helpers for the composer: switching between plain text and HTML, and managing signatures.

export type BodyMode = 'plain' | 'rich' | 'source'

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Blank lines become paragraphs, single newlines become <br>.
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|blockquote|tr)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, '[image: $1]')
  const text = new DOMParser().parseFromString(withBreaks, 'text/html').body.textContent ?? ''
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

// "-- " on its own line is the standard signature separator (RFC 3676); mail clients recognise it.
const PLAIN_SEPARATOR = '\n\n-- \n'

export function withPlainSignature(text: string, signatureHtml: string): string {
  const body = text.split(PLAIN_SEPARATOR)[0]
  return signatureHtml ? `${body}${PLAIN_SEPARATOR}${htmlToText(signatureHtml)}` : body
}

export function withHtmlSignature(html: string, signatureHtml: string): string {
  const body = html.replace(/<div data-signature="">[\s\S]*<\/div>$/, '')
  return signatureHtml ? `${body}<div data-signature="">-- <br>${signatureHtml}</div>` : body
}

// Quote the message being replied to, in the format of the current mode.
export function quoteReply(mode: BodyMode, header: string, original: string): string {
  if (mode === 'plain') return `\n\n${header}\n${original.split('\n').map((line) => `> ${line}`).join('\n')}`
  return `<p><br></p><blockquote>${escapeHtml(header)}<br>${escapeHtml(original)}</blockquote>`
}
