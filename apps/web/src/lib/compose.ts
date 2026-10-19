// Helpers for the composer: quoting, signatures and the plain-text copy of an HTML message.

export type BodyMode = 'rich' | 'source'

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Plain-text alternative sent alongside the HTML, for clients that can't show HTML.
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

// "-- " before the signature is the standard separator (RFC 3676); mail clients recognise it.
export function withHtmlSignature(html: string, signatureHtml: string): string {
  const body = html.replace(/<div data-signature="">[\s\S]*<\/div>$/, '')
  return signatureHtml ? `${body}<div data-signature="">-- <br>${signatureHtml}</div>` : body
}

export function quoteReply(header: string, original: string): string {
  return `<p><br></p><blockquote>${escapeHtml(header)}<br>${escapeHtml(original).replace(/\n/g, '<br>')}</blockquote>`
}
