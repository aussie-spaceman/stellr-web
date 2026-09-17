import { describe, it, expect } from 'vitest'
import { DEFAULT_TIERS, applicableTier, computeRefundOptions, daysOut } from './policy'

// Pure-function checks for the refund compute logic (no DB/Stripe/network).
// Ported from scripts/test-refund-policy.ts, which predated vitest.
const now = new Date('2026-01-01T00:00:00Z')
const eventAt = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString()
const paid = 10000 // $100.00

describe('daysOut', () => {
  it('floors to whole days', () => {
    expect(daysOut(eventAt(120), now)).toBe(120)
    expect(daysOut(eventAt(0), now)).toBe(0)
  })
})

describe('computeRefundOptions with DEFAULT_TIERS', () => {
  it('120 days out → tier 90: 100% cash, no credit', () => {
    const o = computeRefundOptions(applicableTier(DEFAULT_TIERS, eventAt(120), now), paid)
    expect(o.cash).toMatchObject({ cents: 10000, pct: 100 })
    expect(o.credit).toBeFalsy()
  })

  it('60 days out → tier 30: 50% cash or 75% credit valid 730 days', () => {
    const o = computeRefundOptions(applicableTier(DEFAULT_TIERS, eventAt(60), now), paid)
    expect(o.cash?.cents).toBe(5000)
    expect(o.credit).toMatchObject({ cents: 7500, validityDays: 730 })
  })

  it('20 days out → tier 14: 33% cash or 50% credit', () => {
    const o = computeRefundOptions(applicableTier(DEFAULT_TIERS, eventAt(20), now), paid)
    expect(o.cash?.cents).toBe(3300)
    expect(o.credit?.cents).toBe(5000)
  })

  it('5 days out → tier 0: 25% credit only, no cash', () => {
    const o = computeRefundOptions(applicableTier(DEFAULT_TIERS, eventAt(5), now), paid)
    expect(o.cash).toBeFalsy()
    expect(o.credit?.cents).toBe(2500)
  })
})
