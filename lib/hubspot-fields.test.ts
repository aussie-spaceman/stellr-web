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

describe('mapEventYear', () => {
  it('prefers campaignYear over the event date', () => {
    expect(mapEventYear({ campaignYear: 2027, date: '2026-11-06' })).toBe('2027')
  })

  it('falls back to the year of the event date', () => {
    expect(mapEventYear({ date: '2026-11-06' })).toBe('2026')
  })

  it('rejects years outside the portal enumeration', () => {
    expect(mapEventYear({ campaignYear: 2019 })).toBeUndefined()
    expect(mapEventYear({ campaignYear: 2031 })).toBeUndefined()
    expect(mapEventYear({})).toBeUndefined()
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
    const { properties, unmapped } = eventProperties(nevada, 'nevada-space-design-challenge-2026')

    expect(properties).toEqual({
      [HS.eventSlug]: 'nevada-space-design-challenge-2026',
      [HS.eventLocation]: 'Nevada [Las Vegas]',
      [HS.eventYear]: '2026',
      [HS.eventTheme]: 'Space',
      [HS.eventDemographic]: 'High School',
    })
    expect(unmapped).toEqual([])
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
    expect(properties[HS.eventYear]).toBe('2026')
    expect(unmapped).toHaveLength(2)
    expect(unmapped.join(' ')).toMatch(/location/)
    expect(unmapped.join(' ')).toMatch(/theme/)
  })
})
