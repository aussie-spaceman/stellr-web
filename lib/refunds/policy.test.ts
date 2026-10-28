import { describe, it, expect } from 'vitest'
import { GUARANTEE_DAYS, daysSincePayment, guaranteeRefundOptions, withinGuarantee } from './policy'

// The money-back guarantee: 100% within 45 days of payment, nothing after.
const now = new Date('2026-11-01T12:00:00Z')
const paidDaysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000)

describe('daysSincePayment', () => {
  it('floors to whole days and never goes negative', () => {
    expect(daysSincePayment(paidDaysAgo(10.9), now)).toBe(10)
    expect(daysSincePayment(paidDaysAgo(-1), now)).toBe(0)
  })
})

describe('withinGuarantee', () => {
  it('is 45 days', () => {
    expect(GUARANTEE_DAYS).toBe(45)
  })

  it('includes the 45th day and stops after it', () => {
    expect(withinGuarantee(paidDaysAgo(0), now)).toBe(true)
    expect(withinGuarantee(paidDaysAgo(45.5), now)).toBe(true)
    expect(withinGuarantee(paidDaysAgo(46), now)).toBe(false)
  })

  it('treats an unknown payment date as outside — it cannot be checked', () => {
    expect(withinGuarantee(null, now)).toBe(false)
  })
})

describe('guaranteeRefundOptions', () => {
  it('offers the whole amount as cash inside the window', () => {
    expect(guaranteeRefundOptions(paidDaysAgo(30), 7500, now)).toEqual({ cash: { pct: 100, cents: 7500 } })
  })

  it('offers nothing after 45 days, even if the event has not happened', () => {
    expect(guaranteeRefundOptions(paidDaysAgo(60), 7500, now)).toEqual({})
  })

  it('offers nothing when nothing is left to refund', () => {
    expect(guaranteeRefundOptions(paidDaysAgo(3), 0, now)).toEqual({})
  })
})
