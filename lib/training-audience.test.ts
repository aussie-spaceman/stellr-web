import { describe, expect, it } from 'vitest'
import { audienceIncludes, normalizeAudience, objectUsesAudience } from './training-audience'

describe('normalizeAudience', () => {
  it('keeps known values and falls back to all', () => {
    expect(normalizeAudience('volunteers')).toBe('volunteers')
    expect(normalizeAudience('participants')).toBe('participants')
    expect(normalizeAudience(undefined)).toBe('all')
    expect(normalizeAudience('mentors')).toBe('all')
  })
})

describe('audienceIncludes', () => {
  it("'all' includes everyone, even with no roster relationship", () => {
    expect(audienceIncludes('all', [])).toBe(true)
    expect(audienceIncludes(null, ['host'])).toBe(true)
  })

  it('volunteers-only reaches the Volunteers panel and nobody else', () => {
    expect(audienceIncludes('volunteers', ['volunteer'])).toBe(true)
    expect(audienceIncludes('volunteers', ['participant'])).toBe(false)
    expect(audienceIncludes('volunteers', ['host', 'manager'])).toBe(false)
    expect(audienceIncludes('volunteers', [])).toBe(false)
  })

  it('participants-only reaches students, not volunteers or teachers', () => {
    expect(audienceIncludes('participants', ['participant'])).toBe(true)
    expect(audienceIncludes('participants', ['volunteer'])).toBe(false)
    expect(audienceIncludes('participants', ['host'])).toBe(false)
  })

  it('a member with several relationships matches on any of them', () => {
    expect(audienceIncludes('volunteers', new Set(['participant', 'volunteer']))).toBe(true)
  })
})

describe('objectUsesAudience', () => {
  it('applies to events and campaigns only', () => {
    expect(objectUsesAudience('competition')).toBe(true)
    expect(objectUsesAudience('campaign')).toBe(true)
    expect(objectUsesAudience('space')).toBe(false)
    expect(objectUsesAudience('cohort')).toBe(false)
  })
})
