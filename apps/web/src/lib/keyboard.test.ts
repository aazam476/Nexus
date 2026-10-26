// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isTyping } from './keyboard'

// A key press as it would arrive from this element.
function pressOn(element: HTMLElement, init: KeyboardEventInit = {}) {
  let event!: KeyboardEvent
  element.addEventListener('keydown', (e) => (event = e))
  document.body.append(element)
  element.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true, ...init }))
  element.remove()
  return event
}

describe('isTyping', () => {
  it('is true in text fields and editors, so shortcuts don’t eat letters', () => {
    expect(isTyping(pressOn(document.createElement('input')))).toBe(true)
    expect(isTyping(pressOn(document.createElement('textarea')))).toBe(true)
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    Object.defineProperty(editor, 'isContentEditable', { value: true }) // jsdom doesn't compute it
    expect(isTyping(pressOn(editor))).toBe(true)
  })

  it('is false elsewhere, unless a modifier key is held (Cmd+C is copy, not compose)', () => {
    expect(isTyping(pressOn(document.createElement('div')))).toBe(false)
    expect(isTyping(pressOn(document.createElement('div'), { metaKey: true }))).toBe(true)
  })
})
