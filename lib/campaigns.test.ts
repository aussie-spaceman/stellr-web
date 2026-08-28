import { describe, it, expect, vi, afterEach } from 'vitest'
import { getCampaignDates, campaignStatusFromDates, seasonLabel } from './campaigns'

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
