// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// training-audience.13: tracking scores each person only on the courses that are
// mandatory for THEIR tiers. A course mandatory for one tier and N/A for another
// no longer shows the second tier's members as "not started".

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }))

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => h.db.client }))
vi.mock('@/lib/events/repo', () => ({
  getAllEvents: async () => [],
  getAllCampaigns: async () => [],
  getEventsBySlugs: async () => [],
}))

const { effectiveRequirement, getObjectTracking } = await import('./training-admin')

const COHORT = 'cohort-1'
const T1 = 'tier-1'
const T2 = 'tier-2'

const member = (id: string) => ({ cohort_id: COHORT, member_id: id, members: { first_name: 'M', last_name: id, age_bracket: 'high_school' } })
const membership = (member_id: string, tier_id: string, expires_at: string | null = null, renewal_status = 'active') => ({
  member_id,
  tier_id,
  expires_at,
  renewal_status,
})
const grid = (module_id: string, default_requirement: string, tier_requirements: Record<string, string>) => ({
  module_id,
  object_ref: COHORT,
  default_requirement,
  tier_requirements,
  due_at: null,
  training_modules: { title: module_id },
})

function seed(t: {
  assignments?: object[]
  links?: object[]
  memberships?: object[]
  members?: string[]
  progress?: object[]
}) {
  h.db = fakeSupabase({
    mentoring_cohorts: [{ id: COHORT, name: 'Spring Mentoring' }],
    cohort_members: (t.members ?? ['a', 'b', 'c']).map(member),
    course_object_assignments: t.assignments ?? [],
    cohort_training_links: t.links ?? [],
    training_items: [
      { id: 'i-x', module_id: 'mod-x', status: 'published' },
      { id: 'i-y', module_id: 'mod-y', status: 'published' },
    ],
    training_progress: t.progress ?? [],
    member_memberships: t.memberships ?? [],
  })
}

const listed = async () => (await getObjectTracking('cohort', COHORT)).rows.map((r) => r.memberId).sort()

beforeEach(() => {
  h.db = null as unknown as FakeDb
})

describe('effectiveRequirement', () => {
  const g = { default_requirement: 'mandatory', tier_requirements: { [T1]: 'optional', [T2]: 'na' } }

  it('uses the default when none of the person’s tiers is set', () => {
    expect(effectiveRequirement(g, [])).toBe('mandatory')
    expect(effectiveRequirement(g, ['tier-other'])).toBe('mandatory')
  })

  it('is N/A when every set tier is N/A', () => {
    expect(effectiveRequirement(g, [T2])).toBe('na')
  })

  it('takes the strongest tier setting', () => {
    expect(effectiveRequirement(g, [T1, T2])).toBe('optional')
    expect(effectiveRequirement({ default_requirement: 'na', tier_requirements: { [T1]: 'mandatory', [T2]: 'na' } }, [T2, T1])).toBe('mandatory')
  })

  it('ignores a value that is not a requirement', () => {
    expect(effectiveRequirement({ default_requirement: 'optional', tier_requirements: { [T1]: 'sometimes' } }, [T1])).toBe('optional')
  })
})

describe('getObjectTracking applies the tier grid per person', () => {
  it('does not count a member whose tier is N/A as not started', async () => {
    seed({
      assignments: [grid('mod-x', 'mandatory', { [T2]: 'na' })],
      memberships: [membership('a', T1), membership('b', T2)],
    })
    const t = await getObjectTracking('cohort', COHORT)
    // a: tier not set → default Mandatory. b: N/A. c: no tier → default Mandatory.
    expect(t.rows.map((r) => r.memberId).sort()).toEqual(['a', 'c'])
    expect(t.summary).toEqual({ complete: 0, in_progress: 0, not_started: 2, overdue: 0 })
  })

  it('counts only the tiers a course is mandatory for when the default is optional', async () => {
    seed({
      assignments: [grid('mod-x', 'optional', { [T1]: 'mandatory' })],
      memberships: [membership('a', T1), membership('b', T2)],
    })
    expect(await listed()).toEqual(['a'])
  })

  it('a member with a mandatory tier and an N/A tier is counted', async () => {
    seed({
      assignments: [grid('mod-x', 'na', { [T1]: 'mandatory', [T2]: 'na' })],
      memberships: [membership('a', T1), membership('a', T2), membership('b', T2)],
    })
    expect(await listed()).toEqual(['a'])
  })

  it('ignores an expired or inactive membership', async () => {
    seed({
      assignments: [grid('mod-x', 'optional', { [T1]: 'mandatory' })],
      memberships: [membership('a', T1, '2000-01-01'), membership('b', T1, null, 'cancelled'), membership('c', T1, '2999-12-31')],
    })
    expect(await listed()).toEqual(['c'])
  })

  it('scores each person on their own mandatory courses only', async () => {
    seed({
      assignments: [grid('mod-x', 'mandatory', {}), grid('mod-y', 'optional', { [T1]: 'mandatory' })],
      memberships: [membership('a', T1)],
      members: ['a', 'b'],
      // Both have finished mod-x. Only a still owes mod-y.
      progress: [
        { member_id: 'a', item_id: 'i-x', status: 'completed', updated_at: '2026-11-01T00:00:00Z' },
        { member_id: 'b', item_id: 'i-x', status: 'completed', updated_at: '2026-11-01T00:00:00Z' },
      ],
    })
    const rows = (await getObjectTracking('cohort', COHORT)).rows
    expect(Object.fromEntries(rows.map((r) => [r.memberId, r.status]))).toEqual({ a: 'in_progress', b: 'complete' })
  })

  it('a mandatory course with no tier grid still counts for everyone', async () => {
    seed({
      assignments: [grid('mod-x', 'mandatory', { [T2]: 'na' })],
      links: [{ cohort_id: COHORT, module_id: 'mod-y', due_at: null, is_mandatory: true, training_modules: { title: 'Linked' } }],
      memberships: [membership('b', T2)],
    })
    expect(await listed()).toEqual(['a', 'b', 'c'])
  })
})
