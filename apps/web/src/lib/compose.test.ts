// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { htmlToText, quoteReply, textToHtml, withHtmlSignature, withPlainSignature } from './compose'

describe('textToHtml', () => {
  it('turns paragraphs and line breaks into HTML and escapes markup', () => {
    expect(textToHtml('Hi <b>Sara</b>\nsecond line\n\nNew paragraph')).toBe('<p>Hi &lt;b&gt;Sara&lt;/b&gt;<br>second line</p><p>New paragraph</p>')
  })
})

describe('htmlToText', () => {
  it('keeps line structure and list bullets', () => {
    expect(htmlToText('<p>Hi</p><p>One<br>Two</p><ul><li>A</li><li>B</li></ul>')).toBe('Hi\n\nOne\nTwo\n\n• A\n• B')
  })

  it('round-trips plain text', () => {
    const text = 'Line one\nLine two\n\nNext paragraph'
    expect(htmlToText(textToHtml(text))).toBe(text)
  })
})

describe('signatures', () => {
  it('replaces the plain signature instead of stacking it', () => {
    const once = withPlainSignature('Hello', '<b>Ali</b>')
    expect(once).toBe('Hello\n\n-- \nAli')
    expect(withPlainSignature(once, 'Work Ali')).toBe('Hello\n\n-- \nWork Ali')
    expect(withPlainSignature(once, '')).toBe('Hello')
  })

  it('replaces the HTML signature instead of stacking it', () => {
    const once = withHtmlSignature('<p>Hello</p>', '<b>Ali</b>')
    const twice = withHtmlSignature(once, '<i>Work</i>')
    expect(twice).toBe('<p>Hello</p><div data-signature="">-- <br><i>Work</i></div>')
  })
})

describe('quoteReply', () => {
  it('quotes with > in plain mode', () => {
    expect(quoteReply('plain', 'Sara wrote:', 'a\nb')).toBe('\n\nSara wrote:\n> a\n> b')
  })
})
