import { describe, it, expect } from 'vitest'
import { discountedCents, isScholarshipPercent, scholarshipStage, stageAccepted } from '@/lib/scholarship-levels'

describe('discountedCents', () => {
  it.each([
    [16500, 50, 8250],
    [7500, 100, 0],
    [7500, 67, 2475], // 5025 off
    [7500, 33, 5025], // 2475 off
    [0, 50, 0],
  ])('%i at %i%% → %i', (fee, pct, due) => {
    expect(discountedCents(fee, pct)).toBe(due)
  })
})

describe('isScholarshipPercent', () => {
  it('accepts only the four Stripe-backed levels', () => {
    expect([33, 50, 67, 100].every(isScholarshipPercent)).toBe(true)
    expect([0, 25, 75, '50', null].some(isScholarshipPercent)).toBe(false)
  })
})

describe('scholarshipStage', () => {
  it('passes undecided and closed decisions straight through', () => {
    expect(scholarshipStage({ status: 'submitted', registration: null, checkedIn: false })).toBe('submitted')
    expect(scholarshipStage({ status: 'not_offered', registration: null, checkedIn: false })).toBe('not_offered')
  })

  it('reads an offer\'s progress from its registration', () => {
    const offered = (registration: { status: string } | null, checkedIn = false) =>
      scholarshipStage({ status: 'offered', registration, checkedIn })
    expect(offered(null)).toBe('awaiting_details')
    expect(offered({ status: 'withdrawn' })).toBe('awaiting_details')
    expect(offered({ status: 'pending' })).toBe('awaiting_payment')
    expect(offered({ status: 'confirmed' })).toBe('confirmed')
    expect(offered({ status: 'confirmed' }, true)).toBe('attended')
  })

  it('counts confirmed and attended as accepted', () => {
    expect(stageAccepted('confirmed')).toBe(true)
    expect(stageAccepted('attended')).toBe(true)
    expect(stageAccepted('awaiting_payment')).toBe(false)
  })
})
