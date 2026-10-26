// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { htmlToText, quoteReply, withHtmlSignature } from './compose'

describe('htmlToText', () => {
  it('keeps line structure and list bullets', () => {
    expect(htmlToText('<p>Hi</p><p>One<br>Two</p><ul><li>A</li><li>B</li></ul>')).toBe('Hi\n\nOne\nTwo\n\n• A\n• B')
  })
})

describe('signatures', () => {
  it('replaces the HTML signature instead of stacking it', () => {
    const once = withHtmlSignature('<p>Hello</p>', '<b>Ali</b>')
    const twice = withHtmlSignature(once, '<i>Work</i>')
    expect(twice).toBe('<p>Hello</p><div data-signature="">-- <br><i>Work</i></div>')
  })
})

describe('quoteReply', () => {
  it('escapes the original and keeps its line breaks', () => {
    expect(quoteReply('Sara wrote:', 'a <b>\nb')).toBe(
      '<p><br></p><blockquote>Sara wrote:<br>a &lt;b&gt;<br>b</blockquote>',
    )
  })
})
