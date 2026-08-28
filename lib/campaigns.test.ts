import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  getCampaignDates,
  campaignStatusFromDates,
  campaignStatus,
  campaignStatusKey,
  campaignHasEnded,
  seasonLabel,
} from './campaigns'

afterEach(() => {
  vi.useRealTimers()
})

describe('getCampaignDates', () => {
  it('runs a fall campaign in the calendar year before its school year', () => {
    // Campaigns are branded by school year: "Fall 2027" is the autumn term of
    // 2026/27, so it runs Aug–Dec 2026. Deriving it from 2027 put the whole
    // window a year out and every surface read "Coming soon".
    const d = getCampaignDates('fall', 2027)
    expect(d.label).toBe('Fall 2027')
    expect(d.calendarYear).toBe(2026)
    expect(d.startDate).toBe('2026-08-15')
    expect(d.endDate).toBe('2026-12-15')
    expect(d.registrationOpens).toBe('2026-08-01')
    expect(d.registrationCloses).toBe('2026-11-30')
  })

  it('runs a spring campaign in the same year as its school year', () => {
    const d = getCampaignDates('spring', 2027)
    expect(d.label).toBe('Spring 2027')
    expect(d.calendarYear).toBe(2027)
    expect(d.startDate).toBe('2027-01-01')
    expect(d.endDate).toBe('2027-04-30')
    // Registration still opens in the December before the term.
    expect(d.registrationOpens).toBe('2026-12-01')
    expect(d.registrationCloses).toBe('2027-03-31')
  })

  it('puts fall before spring within one school year', () => {
    const fall = getCampaignDates('fall', 2027)
    const spring = getCampaignDates('spring', 2027)
    expect(fall.startDate < spring.startDate).toBe(true)
  })
})

describe('campaignStatusFromDates', () => {
  it('reads a fall campaign as open during its own term', () => {
    vi.setSystemTime(new Date('2026-08-28T12:00:00Z'))
    const d = getCampaignDates('fall', 2027)
    expect(campaignStatusFromDates(d, true)).toBe('Open')
  })

  it('still honours the manual off switch', () => {
    vi.setSystemTime(new Date('2026-08-28T12:00:00Z'))
    expect(campaignStatusFromDates(getCampaignDates('fall', 2027), false)).toBe('Closed')
  })

  it('reads next school year as coming soon, and last year as closed', () => {
    vi.setSystemTime(new Date('2026-08-28T12:00:00Z'))
    expect(campaignStatusFromDates(getCampaignDates('fall', 2028), true)).toBe('Coming soon')
    expect(campaignStatusFromDates(getCampaignDates('spring', 2026), true)).toBe('Closed')
  })
})

describe('seasonLabel', () => {
  it('prints the school year as stored — it is the brand', () => {
    expect(seasonLabel('fall', 2027)).toBe('Fall 2027')
    expect(seasonLabel('spring', 2027)).toBe('Spring 2027')
    expect(seasonLabel(null, 2027)).toBe('')
  })
})

describe('campaignStatus — the one display resolver', () => {
  it('agrees with the admin pill that an unset toggle is not open', () => {
    // The divergence this collapses: the admin pill closed on any falsy value
    // while campaignStatusFromDates only closed on an explicit `false`, so an
    // untouched campaign could read Closed in admin and "Open now" on the
    // public site at the same moment.
    vi.setSystemTime(new Date('2026-08-28T12:00:00Z'))
    const untouched = { season: 'fall', campaignYear: 2027 }
    expect(campaignStatus(untouched)).toBe('Closed')
    expect(campaignStatus({ ...untouched, registrationOpen: null })).toBe('Closed')
    expect(campaignStatus({ ...untouched, registrationOpen: true })).toBe('Open')
  })

  it('still says Coming soon for a future term whatever the toggle says', () => {
    // The dates say when the term runs; the toggle only decides whether you can
    // register during it. A future term is never "Closed".
    vi.setSystemTime(new Date('2026-08-28T12:00:00Z'))
    expect(campaignStatus({ season: 'spring', campaignYear: 2027 })).toBe('Coming soon')
    expect(campaignStatus({ season: 'spring', campaignYear: 2027, registrationOpen: true })).toBe('Coming soon')
  })

  it('falls back to the toggle alone for a half-filled document', () => {
    vi.setSystemTime(new Date('2026-08-28T12:00:00Z'))
    expect(campaignStatus({ registrationOpen: true })).toBe('Open')
    expect(campaignStatus({ season: 'fall', registrationOpen: true })).toBe('Open')
    expect(campaignStatus({})).toBe('Closed')
  })

  it('maps to the kebab keys the member catalog badges use', () => {
    vi.setSystemTime(new Date('2026-08-28T12:00:00Z'))
    expect(campaignStatusKey({ season: 'fall', campaignYear: 2027, registrationOpen: true })).toBe('open')
    expect(campaignStatusKey({ season: 'spring', campaignYear: 2027 })).toBe('coming-soon')
    expect(campaignStatusKey({ season: 'spring', campaignYear: 2026, registrationOpen: true })).toBe('closed')
  })
})

describe('campaignStatusFromDates — app timezone boundary', () => {
  it('keeps a campaign open through the whole close day in Mountain time', () => {
    // 02:00 UTC on 16 Dec is 19:00 on 15 Dec in Denver. Comparing in UTC — the
    // old behaviour — closed the Fall 2027 term ~7h early on its final day.
    vi.setSystemTime(new Date('2026-12-16T02:00:00Z'))
    const d = getCampaignDates('fall', 2027) // ends 2026-12-15
    expect(campaignStatusFromDates(d, true)).toBe('Open')
  })

  it('closes it once the close day has actually passed in Mountain time', () => {
    vi.setSystemTime(new Date('2026-12-16T12:00:00Z')) // 05:00 on 16 Dec in Denver
    expect(campaignStatusFromDates(getCampaignDates('fall', 2027), true)).toBe('Closed')
  })
})

describe('campaignHasEnded', () => {
  it('compares the derived window, never the bare school year', () => {
    // Fall 2027 ends in Dec 2026. Comparing campaignYear against the calendar
    // year kept a term that had finished eight months earlier.
    expect(campaignHasEnded({ season: 'fall', campaignYear: 2027 }, '2026-12-16')).toBe(true)
    expect(campaignHasEnded({ season: 'fall', campaignYear: 2027 }, '2026-08-28')).toBe(false)
    // Fall of school year 2026 ran Aug–Dec 2025 and is long over, even though
    // its year matches the current calendar year.
    expect(campaignHasEnded({ season: 'fall', campaignYear: 2026 }, '2026-08-28')).toBe(true)
  })

  it('keeps an incomplete document visible rather than dropping it', () => {
    expect(campaignHasEnded({ campaignYear: 2027 }, '2026-08-28')).toBe(false)
    expect(campaignHasEnded({ season: 'fall' }, '2026-08-28')).toBe(false)
  })
})
