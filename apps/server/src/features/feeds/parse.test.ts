import { describe, expect, it } from 'vitest'
import { findFeedLink, parseFeed } from './parse.ts'

describe('parseFeed', () => {
  it('reads RSS 2.0, preferring the full post over the teaser', () => {
    const feed = parseFeed(`<?xml version="1.0"?>
      <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
        <channel>
          <title>Homelab Weekly</title>
          <link>https://homelab.example</link>
          <atom:link href="https://homelab.example/feed.xml" rel="self" />
          <item>
            <title>Quiet servers</title>
            <link>https://homelab.example/quiet</link>
            <guid isPermaLink="false">post-112</guid>
            <pubDate>Tue, 10 Mar 2030 09:00:00 GMT</pubDate>
            <description>Short teaser</description>
            <content:encoded><![CDATA[<p>The <b>full</b> post</p>]]></content:encoded>
          </item>
        </channel>
      </rss>`)
    expect(feed).toMatchObject({ title: 'Homelab Weekly', siteUrl: 'https://homelab.example' })
    expect(feed?.items).toEqual([
      {
        guid: 'post-112',
        title: 'Quiet servers',
        link: 'https://homelab.example/quiet',
        author: null,
        content: '<p>The <b>full</b> post</p>',
        summary: 'The full post',
        publishedAt: new Date('2030-03-10T09:00:00Z'),
      },
    ])
  })

  it('reads Atom, with its link attributes and author', () => {
    const feed = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom">
        <title type="text">Ada's notes</title>
        <link rel="self" href="https://ada.example/atom.xml"/>
        <link rel="alternate" href="https://ada.example/"/>
        <entry>
          <title>Engines</title>
          <link href="https://ada.example/engines"/>
          <id>tag:ada.example,2030:1</id>
          <updated>2030-01-02T10:00:00Z</updated>
          <author><name>Ada</name></author>
          <content type="html">&lt;p&gt;Analytical&lt;/p&gt;</content>
        </entry>
      </feed>`)
    expect(feed).toMatchObject({ title: "Ada's notes", siteUrl: 'https://ada.example/' })
    expect(feed?.items[0]).toMatchObject({
      guid: 'tag:ada.example,2030:1',
      link: 'https://ada.example/engines',
      author: 'Ada',
      content: '<p>Analytical</p>',
      publishedAt: new Date('2030-01-02T10:00:00Z'),
    })
  })

  it('reads RSS 1.0 (RDF), where items sit beside the channel', () => {
    const feed =
      parseFeed(`<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
        <channel><title>Old school</title><link>https://old.example</link></channel>
        <item><title>Hello</title><link>https://old.example/hello</link><dc:date>2030-05-01T08:00:00Z</dc:date></item>
      </rdf:RDF>`)
    expect(feed?.items[0]).toMatchObject({
      title: 'Hello',
      guid: 'https://old.example/hello',
      publishedAt: new Date('2030-05-01T08:00:00Z'),
    })
  })

  it('returns null for things that are not feeds', () => {
    expect(parseFeed('<html><body>Hi</body></html>')).toBeNull()
    expect(parseFeed('not xml at all <<<')).toBeNull()
  })

  it('ignores a DOCTYPE, so entity tricks cannot blow up memory', () => {
    const xml = `<!DOCTYPE rss [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>
      <rss><channel><title>Safe</title><item><title>&b;</title></item></channel></rss>`
    const feed = parseFeed(xml)
    expect(feed?.title).toBe('Safe')
    expect(feed?.items[0].title.length ?? 0).toBeLessThan(10)
  })
})

describe('findFeedLink', () => {
  it('finds the feed a web page announces, as a full address', () => {
    const html =
      '<head><link rel="stylesheet" href="/style.css"><link rel="alternate" type="application/rss+xml" title="Posts" href="/feed.xml"></head>'
    expect(findFeedLink(html, 'https://blog.example/about')).toBe('https://blog.example/feed.xml')
    expect(findFeedLink('<head></head>', 'https://blog.example')).toBeNull()
  })
})
