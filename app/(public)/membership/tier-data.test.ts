import { describe, it, expect } from 'vitest'
import { lowestQualifyingTier, membershipUpgradeHref } from './tier-data'

describe('lowestQualifyingTier (F-02)', () => {
  it('picks the lower rung of two tiers on the same ladder', () => {
    expect(lowestQualifyingTier(['Scholar', 'Pathfinder'])?.id).toBe('pathfinder')
  })

  it('resolves a single qualifying tier', () => {
    expect(lowestQualifyingTier(['Catalyst'])?.id).toBe('catalyst')
  })

  it('prefers the lower rung across audiences', () => {
    // Alumni is a base (free) tier; Scholar sits two rungs up its ladder.
    expect(lowestQualifyingTier(['Scholar', 'Alumni'])?.id).toBe('alumni')
  })

  it('returns null for unknown or empty tier lists', () => {
    expect(lowestQualifyingTier([])).toBeNull()
    expect(lowestQualifyingTier(['Not A Tier'])).toBeNull()
  })
})

describe('membershipUpgradeHref (F-02)', () => {
  it('anchors the membership page at the lowest qualifying tier', () => {
    expect(membershipUpgradeHref(['Scholar', 'Pathfinder'])).toBe('/membership#pathfinder')
  })

  it('falls back to the unanchored membership page when nothing resolves', () => {
    expect(membershipUpgradeHref([])).toBe('/membership')
  })
})
