import { describe, it, expect } from 'vitest'
import {
  HS,
  eventProperties,
  mapEventDemographic,
  mapEventLocation,
  mapEventTheme,
  mapEventYear,
  mergeMultiSelect,
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

  it('derives "State [City]" for a US event, whichever way the state is written', () => {
    expect(mapEventLocation({ city: 'Las Vegas', state: 'NV' })).toBe('Nevada [Las Vegas]')
    expect(mapEventLocation({ city: 'Brookings', state: 'South Dakota' })).toBe(
      'South Dakota [Brookings]',
    )
    expect(mapEventLocation({ city: 'Austin', state: 'texas' })).toBe('Texas [Austin]')
  })

  it('derives "Country [City]" outside the US', () => {
    expect(
      mapEventLocation({ city: 'Maldonado', state: 'Departamento de Maldonado', country: 'UY' }),
    ).toBe('Uruguay [Maldonado]')
  })

  it('treats an explicit US country code as the US', () => {
    expect(mapEventLocation({ city: 'Denver', state: 'CO', country: 'US' })).toBe('Colorado [Denver]')
  })

  it('takes the Sanity override over anything derived', () => {
    // The Ashland venue keeps the option its history already sits under.
    expect(
      mapEventLocation({ hubspotLocation: ' Nebraska [SAC Museum] ', city: 'Ashland', state: 'NE' }),
    ).toBe('Nebraska [SAC Museum]')
    expect(mapEventLocation({ hubspotLocation: 'Uruguay', city: 'Maldonado', country: 'UY' })).toBe(
      'Uruguay',
    )
  })

  it('never lets a label carry the multi-select delimiter', () => {
    expect(mapEventLocation({ hubspotLocation: 'Texas; Houston' })).toBe('Texas, Houston')
  })

  it("maps a campaign to its term, since it runs at the participant's own school", () => {
    expect(mapEventLocation({ activityType: 'campaign', season: 'fall' })).toBe('Campaign [Fall]')
    expect(mapEventLocation({ activityType: 'campaign', season: 'spring' })).toBe('Campaign [Spring]')
    expect(mapEventLocation({ activityType: 'campaign' })).toBeUndefined()
  })

  it('returns undefined rather than guessing when the place cannot be read', () => {
    expect(mapEventLocation({ state: 'NV' })).toBeUndefined() // no city
    expect(mapEventLocation({ city: 'Maldonado', state: 'Departamento de Maldonado' })).toBeUndefined()
    expect(mapEventLocation({ city: 'Somewhere', country: 'ZZ' })).toBeUndefined()
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
    expect(mapEventDemographic({ gradeLevel: 'Both' })).toBe('Middle School;High School')
  })

  it('passes through single grade bands', () => {
    expect(mapEventDemographic({ gradeLevel: 'High School' })).toBe('High School')
    expect(mapEventDemographic({ gradeLevel: 'Middle School' })).toBe('Middle School')
  })

  it('follows an explicit band, as the /events grade filter does', () => {
    // Grades 7–12 reaches below 9, so it is both — whatever the bracket says.
    expect(mapEventDemographic({ gradeLevel: 'High School', gradeMin: 7, gradeMax: 12 })).toBe(
      'Middle School;High School',
    )
    expect(mapEventDemographic({ gradeLevel: 'Both', gradeMin: 9, gradeMax: 12 })).toBe('High School')
  })

  it('ignores a half-set band and falls back to the bracket', () => {
    // Uruguay's gradeMin: 8 with no max — gradeBand ignores it, and so do we.
    expect(mapEventDemographic({ gradeLevel: 'High School', gradeMin: 8 })).toBe('High School')
  })

  it('returns undefined for an unknown grade level', () => {
    expect(mapEventDemographic({ gradeLevel: 'Primary' })).toBeUndefined()
    expect(mapEventDemographic({})).toBeUndefined()
  })
})

describe('mergeMultiSelect', () => {
  it("adds the new value to a contact's history instead of replacing it", () => {
    expect(mergeMultiSelect('Texas [Houston];Uruguay', 'Nevada [Las Vegas]')).toBe(
      'Texas [Houston];Uruguay;Nevada [Las Vegas]',
    )
  })

  it('keeps one copy of a value already there', () => {
    expect(mergeMultiSelect('2025;2027', '2027')).toBe('2025;2027')
    expect(mergeMultiSelect('High School', 'Middle School;High School')).toBe(
      'High School;Middle School',
    )
  })

  it('handles a contact with no value yet', () => {
    expect(mergeMultiSelect(undefined, 'High School')).toBe('High School')
    expect(mergeMultiSelect('', '2027')).toBe('2027')
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

  it('rejects years outside a sane window rather than minting an option', () => {
    // The sync adds year options as Sanity needs them, so the guard is a window
    // around now — a typo'd year must not become a permanent option.
    const now = new Date('2026-10-12T00:00:00Z') // school year 2027
    expect(mapEventYear({ campaignYear: 2018, season: 'spring' }, now)).toBeUndefined()
    expect(mapEventYear({ campaignYear: 2030, season: 'spring' }, now)).toBe('2030')
    expect(mapEventYear({ campaignYear: 2031, season: 'spring' }, now)).toBeUndefined()
    expect(mapEventYear({}, now)).toBeUndefined()
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
      { ...nevada, state: 'Departamento de Maldonado', city: 'Maldonado', type: 'Robotics Challenge' },
      'maldonado-robotics-2027',
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
