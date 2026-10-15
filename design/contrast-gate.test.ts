import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// Plain ESM, shared with the token build (design/build-tokens.mjs).
import { contrast, contrastFailures } from './contrast-gate.mjs'

const tokens = JSON.parse(readFileSync(join(__dirname, 'tokens.json'), 'utf8'))

function withValue(path: string, value: string) {
  const copy = JSON.parse(JSON.stringify(tokens))
  const node = path.split('.').reduce((n: Record<string, unknown>, k) => n[k] as Record<string, unknown>, copy)
  ;(node as { $value: string }).$value = value
  return copy
}

describe('design token contrast gate', () => {
  it('passes the current palette', () => {
    expect(contrastFailures(tokens)).toEqual([])
  })

  it('matches published WCAG ratios', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(contrast('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2)
  })

  // The values the mobile review found under AA: each must trip the gate.
  it.each([
    ['color.primary', '#3C6DF6'],
    ['color.spaceViolet', '#7C5CFC'],
    ['color.text.faint', '#8A90AD'],
    ['tier.innovator', '#0E8C99'],
    ['color.heroMuted', '#5A6490'],
  ])('fails %s at the pre-review value %s', (path, value) => {
    expect(contrastFailures(withValue(path, value)).length).toBeGreaterThan(0)
  })
})
