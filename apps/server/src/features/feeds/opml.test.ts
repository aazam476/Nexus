import { describe, expect, it } from 'vitest'
import { buildOpml, parseOpml } from './opml.ts'

describe('OPML', () => {
  it('reads feeds, including ones inside other apps’ folders', () => {
    const feeds = parseOpml(`<?xml version="1.0"?>
      <opml version="2.0"><head><title>Export</title></head><body>
        <outline text="Homelab" type="rss" xmlUrl="https://homelab.example/feed.xml"/>
        <outline text="News">
          <outline text="Paper" title="The Paper" xmlUrl="https://paper.example/rss"/>
          <outline text="Not a feed, just a heading"/>
        </outline>
      </body></opml>`)
    expect(feeds).toEqual([
      { title: 'Homelab', url: 'https://homelab.example/feed.xml' },
      { title: 'The Paper', url: 'https://paper.example/rss' },
    ])
  })

  it('returns null for something that is not OPML', () => {
    expect(parseOpml('<rss><channel/></rss>')).toBeNull()
    expect(parseOpml('just text <<<')).toBeNull()
  })

  it('writes a file that reads back the same, with special characters escaped', () => {
    const feeds = [
      { title: 'Tom & Jerry "News" <daily>', url: 'https://x.example/feed?a=1&b=2', siteUrl: 'https://x.example' },
    ]
    const opml = buildOpml(feeds)
    expect(opml).toContain('Tom &amp; Jerry &quot;News&quot; &lt;daily&gt;')
    expect(parseOpml(opml)).toEqual([{ title: feeds[0].title, url: feeds[0].url }])
  })
})
