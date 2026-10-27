// OPML: the file feed readers use to move a list of feeds from one app to another. It looks like:
//
//   <opml version="2.0">
//     <head><title>My feeds</title></head>
//     <body>
//       <outline text="Homelab Weekly" type="rss" xmlUrl="https://homelab.example/feed.xml"/>
//       <outline text="News">                       ← other apps' folders: outlines inside outlines
//         <outline text="Some paper" xmlUrl="https://paper.example/rss"/>
//       </outline>
//     </body>
//   </opml>
//
// Every outline with an xmlUrl is a feed. Nexus has no folders, so nested feeds are simply all imported.
import { XMLParser } from 'fast-xml-parser'

export interface OpmlFeed {
  title: string
  url: string
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => name === 'outline', // one outline or many: always a list
})

// Returns null when the text isn't an OPML file.
export function parseOpml(xml: string): OpmlFeed[] | null {
  // As with feeds (see parse.ts), a DOCTYPE is never needed and could hide an entity-expansion attack.
  const safeXml = xml.replace(/<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/i, '')
  let doc: Record<string, any>
  try {
    doc = parser.parse(safeXml)
  } catch {
    return null
  }
  if (!doc.opml?.body) return null

  const feeds: OpmlFeed[] = []
  // Walks the outlines, and the outlines inside them, collecting the ones that are feeds.
  function collect(outlines: Record<string, any>[] = []) {
    for (const outline of outlines) {
      const url = outline['@_xmlUrl']
      if (url) feeds.push({ url: String(url).trim(), title: String(outline['@_title'] ?? outline['@_text'] ?? url) })
      collect(outline.outline)
    }
  }
  collect(doc.opml.body.outline)
  return feeds
}

// Text for an XML attribute: the characters that would end or break it are written as entities.
function attribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function buildOpml(feeds: { title: string; url: string; siteUrl: string | null }[]): string {
  const outlines = feeds.map((feed) => {
    const site = feed.siteUrl ? ` htmlUrl="${attribute(feed.siteUrl)}"` : ''
    return `    <outline type="rss" text="${attribute(feed.title)}" title="${attribute(feed.title)}" xmlUrl="${attribute(feed.url)}"${site}/>`
  })
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head><title>Feeds from Nexus</title></head>',
    '  <body>',
    ...outlines,
    '  </body>',
    '</opml>',
    '',
  ].join('\n')
}
