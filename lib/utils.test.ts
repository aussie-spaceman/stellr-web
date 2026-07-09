import { describe, it, expect, vi, afterEach } from 'vitest'
import { formatDateShort, formatDate, formatDateRange, ageFromDob, registrationStatus } from './utils'

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

describe('ageFromDob', () => {
  afterEach(() => vi.useRealTimers())

  it('counts whole years accounting for month and day, not just the year', () => {
    // "Now" = 2026-07-08 (mid-Mountain-day so the zone conversion is unambiguous).
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-08T18:00:00Z'))
    // Birthday already passed this year → full age.
    expect(ageFromDob('2008-01-15')).toBe(18)
    // Birthday LATER this year → still 17 (the year-subtraction bug returned 18,
    // wrongly classifying this minor as an adult and skipping guardian consent).
    expect(ageFromDob('2008-12-01')).toBe(17)
    // Birthday exactly today → counts.
    expect(ageFromDob('2008-07-08')).toBe(18)
  })

  it('returns NaN for an empty/invalid DOB', () => {
    expect(Number.isNaN(ageFromDob(''))).toBe(true)
  })
})

describe('registrationStatus (date-only bounds in app timezone)', () => {
  afterEach(() => vi.useRealTimers())

  it('keeps registration OPEN through the whole close day in Mountain time', () => {
    vi.useFakeTimers()
    // 2026-07-10T01:00Z = 7:00 PM MDT on July 9 — the old UTC-midnight compare
    // wrongly returned "closed" here (~30h early). It must stay open.
    vi.setSystemTime(new Date('2026-07-10T01:00:00Z'))
    expect(registrationStatus(undefined, '2026-07-10')).toBe('open')
  })

  it('closes only after the close day has fully passed in Mountain time', () => {
    vi.useFakeTimers()
    // 2026-07-11T12:00Z = 6:00 AM MDT on July 11 — past all of July 10 MT.
    vi.setSystemTime(new Date('2026-07-11T12:00:00Z'))
    expect(registrationStatus(undefined, '2026-07-10')).toBe('closed')
  })

  it('is coming-soon before the open day starts in Mountain time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-09T12:00:00Z'))
    expect(registrationStatus('2026-07-10', undefined)).toBe('coming-soon')
  })
})
