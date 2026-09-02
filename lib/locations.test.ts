import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { countLocations, fillCounts, normaliseState, numberWord, themeFor, hasPin, type MapLocation } from './locations'

function loc(over: Partial<MapLocation> = {}): MapLocation {
  return {
    id: over.city ?? 'x',
    city: 'Denver',
    state: 'CO',
    theme: 'space',
    status: 'live',
    lat: 39.7,
    lng: -105,
    ...over,
  }
}

describe('normaliseState', () => {
  it('accepts a two-letter code in either case', () => {
    expect(normaliseState('CO')).toBe('CO')
    expect(normaliseState('co')).toBe('CO')
  })

  it('accepts a full state name', () => {
    // The live dataset genuinely holds both spellings — "Colorado" and "CO" —
    // so a distinct-state count over raw strings would report Colorado twice.
    expect(normaliseState('Colorado')).toBe('CO')
    expect(normaliseState('South Dakota')).toBe('SD')
    expect(normaliseState('  north carolina ')).toBe('NC')
  })

  it('rejects anything that is not a US state', () => {
    expect(normaliseState('Departamento de Maldonado')).toBeUndefined()
    expect(normaliseState('ZZ')).toBeUndefined()
    expect(normaliseState('')).toBeUndefined()
    expect(normaliseState(undefined)).toBeUndefined()
  })
})

describe('themeFor', () => {
  it('maps the Sanity theme strings', () => {
    expect(themeFor('Environmental Design Challenge')).toBe('enviro')
    expect(themeFor('Space Design Challenge')).toBe('space')
  })

  it('defaults to space when the theme is unset', () => {
    expect(themeFor(undefined)).toBe('space')
  })
})

describe('countLocations', () => {
  it('counts totals, distinct states, and live events by theme', () => {
    const counts = countLocations([
      loc({ city: 'Las Vegas', state: 'NV' }),
      loc({ city: 'Ashland', state: 'NE' }),
      loc({ city: 'Brookings', state: 'SD' }),
      loc({ city: 'Highlands Ranch', state: 'CO' }),
      loc({ city: 'Denver', state: 'CO', theme: 'enviro' }),
      loc({ city: 'Mankato', state: 'MN', theme: 'enviro' }),
      loc({ city: 'Waco', state: 'TX', status: 'planned' }),
      loc({ city: 'Ames', state: 'IA', status: 'planned' }),
      loc({ city: 'Houston', state: 'TX', status: 'planned' }),
      loc({ city: 'Raleigh', state: 'NC', status: 'planned' }),
    ])
    // The shipped configuration: ten locations, eight states (CO and TX twice).
    expect(counts).toEqual({ total: 10, states: 8, live: 6, planned: 4, space: 4, enviro: 2 })
  })

  it('counts themes for live locations only, so the legend matches the pins', () => {
    const counts = countLocations([
      loc({ city: 'Denver', theme: 'enviro' }),
      loc({ city: 'Waco', state: 'TX', theme: 'space', status: 'planned' }),
    ])
    expect(counts.space).toBe(0)
    expect(counts.enviro).toBe(1)
    expect(counts.planned).toBe(1)
  })

  it('handles an empty set without dividing by anything', () => {
    expect(countLocations([])).toEqual({ total: 0, states: 0, live: 0, planned: 0, space: 0, enviro: 0 })
  })
})

describe('hasPin', () => {
  it('keeps a location with coordinates and rejects one without', () => {
    expect(hasPin(loc())).toBe(true)
    // A row with no coordinates still counts in the legend and the accessible
    // list — it just cannot be drawn. Defaulting it to (0, 0) would put a
    // competition in the Gulf of Guinea.
    expect(hasPin(loc({ lat: Number.NaN, lng: Number.NaN }))).toBe(false)
  })
})

describe('numberWord', () => {
  it('spells out small numbers and falls back to digits', () => {
    expect(numberWord(0)).toBe('zero')
    expect(numberWord(8)).toBe('eight')
    expect(numberWord(20)).toBe('twenty')
    expect(numberWord(21)).toBe('21')
  })
})

describe('fillCounts', () => {
  const counts = { total: 10, states: 8, live: 6, planned: 4, space: 4, enviro: 2 }

  it('interpolates the map lead', () => {
    expect(
      fillCounts(
        '{{Locations}} locations across {{states}} states — {{live}} running now, {{planned}} in planning.',
        counts,
      ),
    ).toBe('Ten locations across eight states — six running now, four in planning.')
  })

  it('capitalises only when the token name is capitalised', () => {
    expect(fillCounts('{{states}} / {{States}}', counts)).toBe('eight / Eight')
  })

  it('leaves an unknown token visible rather than throwing', () => {
    // This runs inside a marketing page render. A visible {{typo}} is a much
    // better failure than a 500 on the page the ads point at.
    expect(fillCounts('{{nope}} and {{live}}', counts)).toBe('{{nope}} and six')
  })

  it('leaves copy with no tokens untouched', () => {
    expect(fillCounts('Registration is set per event.', counts)).toBe(
      'Registration is set per event.',
    )
  })
})
