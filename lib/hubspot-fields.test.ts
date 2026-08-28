import { describe, it, expect } from 'vitest'
import {
  HS,
  eventProperties,
  mapEventDemographic,
  mapEventLocation,
  mapEventTheme,
  mapEventYear,
} from './hubspot-fields'

/**
 * These mappings decide what a lead is tagged with in the CRM, and HubSpot is
 * the source of truth for leads. The contract worth defending is not "map
 * everything" but "never invent a value" — a blank property can be backfilled,
 * a wrong one quietly corrupts a segment and the mailing that follows it.
 */

describe('mapEventLocation', () => {
  it('maps a virtual event regardless of city or state', () => {
    expect(mapEventLocation({ setting: 'virtual', city: 'Las Vegas', state: 'NV' })).toBe(
      'Virtual [Zoom + Discord]',
    )
  })

  it('maps by state abbreviation and full name alike', () => {
    expect(mapEventLocation({ state: 'NV' })).toBe('Nevada [Las Vegas]')
    expect(mapEventLocation({ state: 'nevada' })).toBe('Nevada [Las Vegas]')
  })

  it('prefers the city when it is more specific than the state', () => {
    expect(mapEventLocation({ city: 'Houston', state: 'TX' })).toBe('Texas [Houston]')
  })

  it('recognises ISSDC Finals by title, since the venue moves each year', () => {
    expect(mapEventLocation({ title: '2027 ISSDC Finals', state: 'FL' })).toBe('ISSDC Finals')
  })

  it('returns undefined rather than guessing an unknown location', () => {
    expect(mapEventLocation({ city: 'Boise', state: 'ID' })).toBeUndefined()
    expect(mapEventLocation({})).toBeUndefined()
  })
})

describe('mapEventTheme', () => {
  it('reduces the full Sanity challenge name to the portal theme', () => {
    expect(mapEventTheme('Space Design Challenge')).toBe('Space')
    expect(mapEventTheme('Environmental Design Challenge')).toBe('Environmental')
  })

  it('tolerates suffixed variants', () => {
    expect(mapEventTheme('Space Design Challenge — Regional Final')).toBe('Space')
  })

  it('returns undefined for an unmapped or missing theme', () => {
    expect(mapEventTheme('Robotics Challenge')).toBeUndefined()
    expect(mapEventTheme(undefined)).toBeUndefined()
  })
})

describe('mapEventDemographic', () => {
  it('expands "Both" into the multi-select pair rather than picking one', () => {
    expect(mapEventDemographic('Both')).toBe('Middle School;High School')
  })

  it('passes through single grade bands', () => {
    expect(mapEventDemographic('High School')).toBe('High School')
  })

  it('returns undefined for an unknown grade level', () => {
    expect(mapEventDemographic('Primary')).toBeUndefined()
  })
})

/**
 * Stellr names events for the school year they end in, not the calendar year
 * they occur in — the Nevada challenge runs in November 2026 and is a 2027
 * event. Tagging it 2026 made `event_year = 2027` return nothing, which is the
 * exact segmentation failure this mapping exists to prevent.
 */
describe('mapEventYear', () => {
  it('maps an autumn event to the school year it ends in', () => {
    // November 2026 → the 2026–27 school year → 2027, matching the slug.
    expect(mapEventYear({ date: '2026-11-06' })).toBe('2027')
  })

  it('maps a spring event to the same school year', () => {
    expect(mapEventYear({ date: '2027-03-14' })).toBe('2027')
  })

  it('puts August on the new school year and May on the old one', () => {
    expect(mapEventYear({ date: '2026-08-01' })).toBe('2027')
    expect(mapEventYear({ date: '2026-05-31' })).toBe('2026')
  })

  it('treats the summer gap as the year that just ended', () => {
    // June/July sit outside the teaching year; no boundary is invented.
    expect(mapEventYear({ date: '2026-06-15' })).toBe('2026')
    expect(mapEventYear({ date: '2026-07-31' })).toBe('2026')
  })

  it('takes a campaign year as the school year it already is', () => {
    // Campaigns are branded by school year, so both seasons of 2026/27 are 2027
    // — the fall term runs in calendar 2026 and the spring term in calendar 2027.
    expect(mapEventYear({ campaignYear: 2027, season: 'fall' })).toBe('2027')
    expect(mapEventYear({ campaignYear: 2027, season: 'spring' })).toBe('2027')
  })

  it('falls back to the date when a campaign has no season', () => {
    // No season means the document is half-filled; the date decides instead of
    // the bare number, which could be either a school or a calendar year.
    expect(mapEventYear({ campaignYear: 2026, date: '2026-11-06' })).toBe('2027')
  })

  it('rejects years outside the portal enumeration', () => {
    expect(mapEventYear({ campaignYear: 2018, season: 'spring' })).toBeUndefined()
    expect(mapEventYear({ campaignYear: 2031, season: 'spring' })).toBeUndefined()
    expect(mapEventYear({})).toBeUndefined()
  })

  it('ignores a malformed date rather than guessing', () => {
    expect(mapEventYear({ date: '2026' })).toBeUndefined()
    expect(mapEventYear({ date: 'not-a-date' })).toBeUndefined()
  })
})

describe('eventProperties', () => {
  const nevada = {
    title: 'Nevada Space Design Challenge',
    type: 'Space Design Challenge',
    gradeLevel: 'High School',
    setting: 'in_person',
    city: 'Las Vegas',
    state: 'NV',
    date: '2026-11-06',
  }

  it('builds the full property patch for a well-formed event', () => {
    const { properties, unmapped } = eventProperties(nevada, 'nevada-space-design-challenge-2027')

    expect(properties).toEqual({
      [HS.eventSlug]: 'nevada-space-design-challenge-2027',
      [HS.eventLocation]: 'Nevada [Las Vegas]',
      // November 2026 is the 2027 school year — the year in the slug.
      [HS.eventYear]: '2027',
      [HS.eventTheme]: 'Space',
      [HS.eventDemographic]: 'High School',
    })
    expect(unmapped).toEqual([])
  })

  it('derives a year that agrees with the year in the slug', () => {
    const { properties } = eventProperties(nevada, 'nevada-space-design-challenge-2027')
    expect(properties[HS.eventSlug]).toContain(properties[HS.eventYear])
  })

  it('always records the slug, which is the join key back to the website', () => {
    const { properties } = eventProperties({}, 'mystery-event')
    expect(properties[HS.eventSlug]).toBe('mystery-event')
  })

  it('omits and reports fields it cannot map instead of writing a guess', () => {
    const { properties, unmapped } = eventProperties(
      { ...nevada, state: 'ID', city: 'Boise', type: 'Robotics Challenge' },
      'boise-robotics-2026',
    )

    expect(properties[HS.eventLocation]).toBeUndefined()
    expect(properties[HS.eventTheme]).toBeUndefined()
    // The mappable fields still land.
    expect(properties[HS.eventYear]).toBe('2027')
    expect(unmapped).toHaveLength(2)
    expect(unmapped.join(' ')).toMatch(/location/)
    expect(unmapped.join(' ')).toMatch(/theme/)
  })
})
