import { describe, it, expect } from 'vitest'
import { formatDateShort, formatDate, formatDateRange } from './utils'

describe('formatDateShort', () => {
  it('renders a bare calendar date without shifting a day (W6.7 regression)', () => {
    // "2026-07-08" is a Postgres date; it must read Jul 8 regardless of the app's
    // Mountain timezone (the bug rendered it as "Jul 7").
    expect(formatDateShort('2026-07-08')).toBe('Jul 8, 2026')
  })

  it('localises a real timestamp to the app timezone (America/Denver)', () => {
    // 13:48 UTC is still Jul 8 in Mountain time…
    expect(formatDateShort('2026-07-08T13:48:59Z')).toBe('Jul 8, 2026')
    // …but 02:00 UTC is the previous evening in Mountain time.
    expect(formatDateShort('2026-07-08T02:00:00Z')).toBe('Jul 7, 2026')
  })
})

describe('formatDate', () => {
  it('renders a bare calendar date in long form without shifting', () => {
    expect(formatDate('2026-07-08')).toBe('July 8, 2026')
  })

  it('tolerates a full timestamp (no longer produces Invalid Date)', () => {
    expect(formatDate('2026-07-08T13:48:59Z')).toBe('July 8, 2026')
  })
})

describe('formatDateRange', () => {
  it('collapses a same-month range', () => {
    expect(formatDateRange('2026-07-08', '2026-07-10')).toBe('July 8–10, 2026')
  })

  it('spells out a cross-month range', () => {
    expect(formatDateRange('2026-07-30', '2026-08-02')).toBe('July 30, 2026 – August 2, 2026')
  })

  it('falls back to a single date when there is no end (or equal)', () => {
    expect(formatDateRange('2026-07-08')).toBe('July 8, 2026')
    expect(formatDateRange('2026-07-08', '2026-07-08')).toBe('July 8, 2026')
  })
})
