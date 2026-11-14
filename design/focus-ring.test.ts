import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// Plain ESM, shared with the token build (design/build-tokens.mjs).
import { contrast } from './contrast-gate.mjs'

// The global keyboard-focus ring (a11y REC item 9): design/tokens.json
// focusRing, drawn by the :focus-visible rule in styles/globals.css.
const tokens = JSON.parse(readFileSync(join(__dirname, 'tokens.json'), 'utf8'))
const globals = readFileSync(join(__dirname, '..', 'styles', 'globals.css'), 'utf8')

/** A token's colour, following one level of {group.name} alias. */
function colour(path: string): string {
  const value = path.split('.').reduce((n, k) => n?.[k], tokens)?.$value as string
  const alias = /^\{(.+)\}$/.exec(value)
  return alias ? colour(alias[1]) : value
}

describe('focus ring tokens', () => {
  // WCAG 1.4.11: 3:1 against what sits next to it.
  it.each(['color.white', 'color.surface', 'color.midnight'])('the ring is at least 3:1 on %s', (bg) => {
    expect(contrast(colour('focusRing.color'), colour(bg))).toBeGreaterThanOrEqual(3)
  })

  it.each(['color.primary', 'color.primaryDeep', 'color.midnight'])('the halo is at least 3:1 on %s fills', (bg) => {
    expect(contrast(colour('focusRing.halo'), colour(bg))).toBeGreaterThanOrEqual(3)
  })

  it('is at least 2px wide, with the halo filling the offset', () => {
    expect(parseFloat(tokens.focusRing.width.$value)).toBeGreaterThanOrEqual(2)
    expect(parseFloat(tokens.focusRing.offset.$value)).toBeGreaterThan(0)
  })
})

describe('global :focus-visible rule (styles/globals.css)', () => {
  const rule = /:where\((.*)\):focus-visible\s*\{([^}]*)\}/.exec(globals)

  it('covers links, buttons, fields, summary and tabindex', () => {
    expect(rule).not.toBeNull()
    for (const sel of ['a', 'button', 'input', 'select', 'textarea', 'summary', '[tabindex]']) {
      expect(rule![1]).toContain(sel)
    }
  })

  it('draws only from the focus-ring tokens', () => {
    const body = rule![2]
    expect(body).toContain('var(--focus-ring-width) solid var(--focus-ring-color)')
    expect(body).toContain('outline-offset: var(--focus-ring-offset)')
    expect(body).toContain('var(--focus-ring-halo)')
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  it('uses :focus-visible, not :focus, for the .btn-* rings (no ring on a mouse click)', () => {
    const btnRules = globals.match(/\.btn-[a-z-]+ \{\n\s*@apply [^\n]*/g) ?? []
    expect(btnRules.length).toBeGreaterThan(0)
    for (const r of btnRules) {
      expect(r).toContain('focus-visible:ring-2')
      expect(r).not.toMatch(/(^|\s)focus:/)
    }
  })
})
