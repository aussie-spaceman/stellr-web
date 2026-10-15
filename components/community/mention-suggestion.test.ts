import { describe, it, expect } from 'vitest'
import { placeMentionMenu } from './mention-suggestion'

// A 375 x 667 phone; the keyboard takes the bottom ~300px when it's up.
const phone = { left: 0, top: 0, width: 375, height: 667 }
const keyboardUp = { left: 0, top: 0, width: 375, height: 360 }
const menu = { width: 224, height: 200 }

describe('placeMentionMenu', () => {
  it('sits under the caret when there is room', () => {
    const pos = placeMentionMenu({ left: 40, top: 100, bottom: 120 }, menu, phone)
    expect(pos.top).toBe(124)
    expect(pos.left).toBe(40)
  })

  it('flips above the caret when the keyboard leaves no room below', () => {
    const caret = { left: 40, top: 300, bottom: 320 }
    const pos = placeMentionMenu(caret, menu, keyboardUp)
    expect(pos.top + menu.height).toBeLessThanOrEqual(caret.top)
    expect(pos.top).toBeGreaterThanOrEqual(keyboardUp.top)
  })

  it('stays inside the screen when the caret is near the right edge', () => {
    const pos = placeMentionMenu({ left: 330, top: 100, bottom: 120 }, menu, phone)
    expect(pos.left + menu.width).toBeLessThanOrEqual(phone.width)
    expect(pos.left).toBeGreaterThanOrEqual(0)
  })

  it('works in the visual viewport while Safari has panned it', () => {
    const panned = { left: 0, top: 250, width: 375, height: 360 }
    const caret = { left: 40, top: 560, bottom: 580 }
    const pos = placeMentionMenu(caret, menu, panned)
    expect(pos.top).toBeGreaterThanOrEqual(panned.top)
    expect(pos.top + menu.height).toBeLessThanOrEqual(caret.top)
  })

  it('caps the list to the room it got, and to the screen width', () => {
    const pos = placeMentionMenu({ left: 10, top: 100, bottom: 120 }, { width: 400, height: 900 }, { left: 0, top: 0, width: 320, height: 568 })
    expect(pos.maxWidth).toBeLessThanOrEqual(320)
    expect(pos.top + pos.maxHeight).toBeLessThanOrEqual(568)
  })
})
