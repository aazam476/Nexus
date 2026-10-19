// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { buildSafeEmailDocument } from './sanitize'

describe('buildSafeEmailDocument', () => {
  it('removes scripts and event handlers', () => {
    const { html } = buildSafeEmailDocument('<p onclick="steal()">Hi</p><script>alert(1)</script><img src=x onerror="alert(1)">', false)
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/onclick|onerror/i)
    expect(html).toContain('<p>Hi</p>')
  })

  it('removes javascript: links', () => {
    const { html } = buildSafeEmailDocument('<a href="javascript:alert(1)">x</a>', false)
    expect(html).not.toMatch(/javascript:/i)
  })

  it('blocks remote images unless allowed', () => {
    const blocked = buildSafeEmailDocument('<img src="https://track.example/p.gif">', false)
    expect(blocked.blockedImages).toBe(1)
    expect(blocked.html).not.toMatch(/\ssrc="https:/)

    const allowed = buildSafeEmailDocument('<img src="https://track.example/p.gif">', true)
    expect(allowed.blockedImages).toBe(0)
    expect(allowed.html).toContain('src="https://track.example/p.gif"')
  })

  it('strips forms so emails cannot phish inside Nexus', () => {
    const { html } = buildSafeEmailDocument('<form action="https://evil"><input name="password"></form>', false)
    expect(html).not.toMatch(/<form|<input/i)
  })
})

describe('sanitizeForEditor', () => {
  it('drops event handlers but keeps formatting, inline images and the signature marker', async () => {
    const { sanitizeForEditor } = await import('./sanitize')
    const clean = sanitizeForEditor('<b onclick="x()">Ali</b><img src="x" onerror="steal()"><img src="data:image/png;base64,AAAA"><div data-signature="">-- </div><script>bad()</script>')
    expect(clean).not.toMatch(/onclick|onerror|<script/)
    expect(clean).toContain('<b>Ali</b>')
    expect(clean).toContain('src="data:image/png;base64,AAAA"')
    expect(clean).toContain('data-signature=""')
  })
})
