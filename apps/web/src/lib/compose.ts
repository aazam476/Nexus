// Helpers for the composer: quoting, signatures and the plain-text copy of an HTML message.
import type { Message } from '../types'
import { replySubject } from './format'
import type { Draft } from './store'

export type BodyMode = 'rich' | 'source'

// Makes text safe to put inside HTML: "<b>" shows as the characters <b>, not as bold.
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Plain-text alternative sent alongside the HTML, for clients that can't show HTML.
export function htmlToText(html: string): string {
  // First turn the tags that mean "line break" into real line breaks, so the text keeps its shape.
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n') // <br>, <br/>, <br />
    .replace(/<\/(p|div|h[1-6]|blockquote|tr)>/gi, '\n\n') // the end of a paragraph or block: a blank line
    .replace(/<li[^>]*>/gi, '• ') // list items get a bullet…
    .replace(/<\/li>/gi, '\n') // …and end their line
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, '[image: $1]') // images become their description
  // Then let the browser drop all remaining tags and decode entities like &amp;.
  const text = new DOMParser().parseFromString(withBreaks, 'text/html').body.textContent ?? ''
  return text.replace(/\n{3,}/g, '\n\n').trim() // at most one blank line in a row
}

// "-- " before the signature is the standard separator (RFC 3676); mail clients recognise it.
export function withHtmlSignature(html: string, signatureHtml: string): string {
  // Remove the old signature: the <div data-signature=""> block at the very end.
  const body = html.replace(/<div data-signature="">[\s\S]*<\/div>$/, '')
  return signatureHtml ? `${body}<div data-signature="">-- <br>${signatureHtml}</div>` : body
}

// The start of a reply: an empty line to type in, then the original quoted below ("On …, Ann wrote:").
export function quoteReply(header: string, original: string): string {
  return `<p><br></p><blockquote>${escapeHtml(header)}<br>${escapeHtml(original).replace(/\n/g, '<br>')}</blockquote>`
}

// ---------- Starting a reply or a forward ----------
// What the composer opens with. `message` should be the full message (with its Message-ID and text),
// not just a list row, so the reply threads correctly and quotes the whole text.

export function replyDraft(message: Message, options: { all: boolean; ownEmail?: string }): Partial<Draft> {
  // "Reply all" copies everyone else the message went to, but not yourself.
  const everyone = [...message.to, ...message.cc].map((person) => person.email)
  const others = everyone.filter((email) => email !== options.ownEmail)
  return {
    accountId: message.accountId,
    to: message.from.email,
    cc: options.all ? others.join(', ') : '',
    subject: replySubject(message.subject),
    replyTo: message,
  }
}

export function forwardDraft(message: Message): Partial<Draft> {
  return {
    accountId: message.accountId,
    subject: replySubject(message.subject, 'Fwd'),
    replyTo: message,
    forwardOf: message.id, // the server attaches the original's files
  }
}
