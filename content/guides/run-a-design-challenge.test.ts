import { describe, expect, it } from 'vitest'
import { SENSITIVITY_WEIGHTS, TRADE_STUDY, tradeStudyTotals } from './run-a-design-challenge'

// The page's prose ("A leads, but move ten points and C wins") depends on
// these numbers. If anyone edits the scores or weights, this fails first.
describe('trade study worked example', () => {
  it('has weights that sum to 100%', () => {
    expect(TRADE_STUDY.criteria.reduce((s, c) => s + c.weight, 0)).toBe(100)
    expect(SENSITIVITY_WEIGHTS.reduce((s, w) => s + w, 0)).toBe(100)
  })

  it('ranks A first on the stated weights', () => {
    expect(tradeStudyTotals().map((t) => t.toFixed(2))).toEqual(['3.25', '2.85', '3.10'])
  })

  it('flips to C under the sensitivity weights', () => {
    expect(tradeStudyTotals(SENSITIVITY_WEIGHTS).map((t) => t.toFixed(2))).toEqual(['3.05', '3.05', '3.10'])
  })
})
