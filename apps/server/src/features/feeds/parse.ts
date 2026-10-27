// Reading RSS and Atom feeds: the two XML formats websites use to list their latest posts.
//
//   RSS 2.0   <rss><channel><title/><link/><item><title/><link/><guid/><pubDate/><description/></item>…
//   RSS 1.0   <rdf:RDF><channel>…</channel><item>…</item>… (items sit beside the channel, not in it)
//   Atom      <feed><title/><link href=""/><entry><title/><link href=""/><id/><updated/><content/></entry>…
//
// All three become the same simple shape, ParsedFeed.
import { XMLParser } from 'fast-xml-parser'
import { makePreview } from '../mail/parse.ts'

export interface ParsedItem {
  guid: string
  title: string
  link: string | null
  author: string | null
  content: string // HTML (or plain text) as the feed gives it; sanitized later, when shown
  summary: string
  publishedAt: Date
}

export interface ParsedFeed {
  title: string
  siteUrl: string | null
  items: ParsedItem[]
}

const parser = new XMLParser({
  ignoreAttributes: false, // we need attributes, like Atom's <link href="…">
  attributeNamePrefix: '@_', // an attribute "href" becomes the key "@_href"
  removeNSPrefix: true, // "content:encoded" becomes "encoded", "dc:creator" becomes "creator"
  // These can appear once or many times; always get a list, so the code below needn't check.
  isArray: (name) => ['item', 'entry', 'link'].includes(name),
})

// The parser gives text as a string or number, or as { '#text': '…', '@_type': 'html' } when the
// tag has attributes, or as a list when the tag repeats. This always returns plain text.
function text(value: unknown): string {
  if (value == null) return ''
  if (Array.isArray(value)) return text(value[0])
  if (typeof value === 'object') return text((value as Record<string, unknown>)['#text'])
  return String(value).trim()
}

// Atom links are <link href="…" rel="alternate"/>; RSS links are <link>…</link>. Returns the web page link.
function pageLink(links: unknown): string | null {
  for (const link of (links as unknown[] | undefined) ?? []) {
    if (typeof link === 'string' && link.trim()) return link.trim() // RSS
    const attributes = link as Record<string, string>
    const isPageLink = !attributes['@_rel'] || attributes['@_rel'] === 'alternate'
    if (attributes['@_href'] && isPageLink) return attributes['@_href'] // Atom
  }
  return null
}

function date(value: string): Date {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed // no date, or one we can't read: "now"
}

// Returns null when the text isn't a feed (for example a normal web page).
export function parseFeed(xml: string): ParsedFeed | null {
  // A DOCTYPE can define "entities" that expand into huge text (a "billion laughs" attack).
  // Feeds never need one, so it's removed before parsing.
  const safeXml = xml.replace(/<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/i, '')
  let doc: Record<string, any>
  try {
    doc = parser.parse(safeXml)
  } catch {
    return null
  }

  if (doc.feed) return atom(doc.feed)
  if (doc.rss?.channel) return rss(doc.rss.channel, doc.rss.channel.item)
  if (doc.RDF?.channel) return rss(doc.RDF.channel, doc.RDF.item)
  return null
}

function rss(channel: Record<string, any>, items: Record<string, any>[] = []): ParsedFeed {
  return {
    title: text(channel.title) || 'Untitled feed',
    siteUrl: pageLink(channel.link),
    items: items.map((item) => {
      const link = pageLink(item.link)
      // content:encoded holds the full post; description is often just a teaser.
      const content = text(item.encoded) || text(item.description)
      return {
        guid: text(item.guid) || link || text(item.title),
        title: text(item.title) || 'Untitled',
        link,
        author: text(item.creator) || text(item.author) || null,
        content,
        summary: makePreview(content),
        publishedAt: date(text(item.pubDate) || text(item.date)), // "date" is RSS 1.0's dc:date
      }
    }),
  }
}

function atom(feed: Record<string, any>): ParsedFeed {
  return {
    title: text(feed.title) || 'Untitled feed',
    siteUrl: pageLink(feed.link),
    items: ((feed.entry as Record<string, any>[]) ?? []).map((entry) => {
      const link = pageLink(entry.link)
      const content = text(entry.content) || text(entry.summary)
      return {
        guid: text(entry.id) || link || text(entry.title),
        title: text(entry.title) || 'Untitled',
        link,
        author: text(entry.author?.name) || null,
        content,
        summary: makePreview(content),
        publishedAt: date(text(entry.published) || text(entry.updated)),
      }
    }),
  }
}

// People often paste a website's address rather than its feed's. Websites announce their feed with
//   <link rel="alternate" type="application/rss+xml" href="/feed.xml">
// in the page's HTML. This finds that link and makes it a full address.
export function findFeedLink(html: string, pageUrl: string): string | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const isFeed = /type=["']application\/(rss|atom)\+xml["']/i.test(tag)
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1]
    if (isFeed && href) return new URL(href, pageUrl).toString()
  }
  return null
}
