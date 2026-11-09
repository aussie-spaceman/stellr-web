import { describe, it, expect } from 'vitest'
import {
  AUDIENCES, WATERFALL_CATEGORIES, WATERFALL_ITEMS, WATERFALL_TOTAL,
  educatorTierHighlights, lowestQualifyingTier, membershipUpgradeHref, waterfallCounts,
} from './tier-data'

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

/* ── 2027 Membership Tiers flyer — canon guards ───────────────────────────────
   These pin the teacher ladder to the flyer. They exist because the ladder was
   previously duplicated in /competitions and the two copies drifted apart. */

describe('2027 teacher ladder', () => {
  const edu = AUDIENCES.educator.tiers

  it('has the four canonical tiers in flyer order', () => {
    expect(edu.map((t) => t.name)).toEqual(['Educator', 'Catalyst', 'Innovator', 'Trailblazer'])
  })

  it('offers the free tier only ABRIDGED core material', () => {
    const core = WATERFALL_ITEMS.filter((i) => i.t === 0 && i.c === 'core').map((i) => i.x)
    expect(core).toHaveLength(2)
    for (const x of core) expect(x).toMatch(/abridged/i)
    // …and the full editions arrive at Catalyst, as upgrades rather than new items.
    const full = WATERFALL_ITEMS.filter((i) => i.t === 1 && i.c === 'core' && i.up)
    expect(full.map((i) => i.x)).toEqual(['RFP — full edition', 'Mission Handbook — full edition'])
  })

  it('carries no store or academy discount on any teacher tier', () => {
    for (const t of edu) {
      expect(t.store).toBeUndefined()
      expect(t.academy).toBeUndefined()
    }
  })

  it('grants the Pathfinder student upgrade on Trailblazer only', () => {
    const pathfinder = WATERFALL_ITEMS.filter((i) => /Pathfinder/.test(i.x))
    expect(pathfinder).toHaveLength(1)
    expect(pathfinder[0].t).toBe(3)
  })

  it('uses only the six flyer categories', () => {
    expect(WATERFALL_CATEGORIES.map((c) => c.key))
      .toEqual(['core', 'teacher', 'student', 'live', 'cte', 'ai'])
    const used = new Set(WATERFALL_ITEMS.map((i) => i.c))
    const known = new Set(WATERFALL_CATEGORIES.map((c) => c.key))
    for (const k of used) expect(known.has(k)).toBe(true)
  })

  it('excludes upgrade steps from the benefit counter', () => {
    // 41 flyer lines, 11 of which deepen a benefit the member already holds
    // (5 at Catalyst, 4 at Innovator, 2 at Trailblazer).
    expect(WATERFALL_ITEMS).toHaveLength(41)
    expect(WATERFALL_ITEMS.filter((i) => i.up)).toHaveLength(11)
    expect(WATERFALL_TOTAL).toBe(30)
    const summed = [0, 1, 2, 3].reduce((n, t) => n + waterfallCounts(t).added, 0)
    expect(summed).toBe(WATERFALL_TOTAL)
  })

  it('gives every tier a category-balanced highlight list', () => {
    for (let t = 0; t < edu.length; t++) {
      const hi = educatorTierHighlights(t)
      expect(hi.length).toBeGreaterThanOrEqual(4)
      expect(hi.length).toBeLessThanOrEqual(5)
      expect(new Set(hi).size).toBe(hi.length)
      // every highlight is a real line from that tier
      const own = new Set(WATERFALL_ITEMS.filter((i) => i.t === t).map((i) => i.x))
      for (const x of hi) expect(own.has(x)).toBe(true)
    }
  })
})
