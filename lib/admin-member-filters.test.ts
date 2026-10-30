import { describe, it, expect } from 'vitest'
import {
  EMPTY_MEMBER_FILTERS,
  activeMemberFilterCount,
  applyMemberFilters,
  applyMemberSort,
  cleanFilterText,
  memberFilterEmbeds,
  memberFilterParams,
  parseMemberFilters,
  type FilterableQuery,
  type MemberFilters,
} from './admin-member-filters'

const TIER = '11111111-1111-4111-8111-111111111111'

/** Records each builder call so a test can read back the query it built. */
class Recorder implements FilterableQuery<Recorder> {
  calls: string[] = []
  private add(s: string) { this.calls.push(s); return this }
  or(f: string) { return this.add(`or ${f}`) }
  ilike(c: string, p: string) { return this.add(`ilike ${c} ${p}`) }
  eq(c: string, v: unknown) { return this.add(`eq ${c} ${String(v)}`) }
  is(c: string, v: null) { return this.add(`is ${c} ${String(v)}`) }
  gte(c: string, v: string) { return this.add(`gte ${c} ${v}`) }
  lt(c: string, v: string) { return this.add(`lt ${c} ${v}`) }
  order(c: string, o: { ascending: boolean }) { return this.add(`order ${c} ${o.ascending ? 'asc' : 'desc'}`) }
}

const f = (over: Partial<MemberFilters>): MemberFilters => ({ ...EMPTY_MEMBER_FILTERS, ...over })

describe('parseMemberFilters', () => {
  it('drops values that are not on the allowed lists', () => {
    const parsed = parseMemberFilters({ role: 'admin', bracket: 'toddler', tier: 'gold', sort: 'phone', dir: 'sideways', joinedFrom: 'yesterday' })
    expect(parsed).toEqual(EMPTY_MEMBER_FILTERS)
  })

  it('keeps valid values, a tier id, and the "none" tier', () => {
    expect(parseMemberFilters({ role: 'mentor', tier: TIER, joinedTo: '2026-10-29', sort: 'joined', dir: 'desc' }))
      .toMatchObject({ role: 'mentor', tier: TIER, joinedTo: '2026-10-29', sort: 'joined', dir: 'desc' })
    expect(parseMemberFilters({ tier: 'none' }).tier).toBe('none')
  })

  it('takes the first value of a repeated param', () => {
    expect(parseMemberFilters({ name: ['ava', 'bo'] }).name).toBe('ava')
  })
})

describe('cleanFilterText', () => {
  it('strips the characters that would break a PostgREST or() filter', () => {
    expect(cleanFilterText('a,b),email.eq.x(%*')).toBe('a b email.eq.x')
  })

  it('keeps underscores and plus signs, which are common in email addresses', () => {
    expect(cleanFilterText('first_last+tag@example.org')).toBe('first_last+tag@example.org')
  })
})

describe('memberFilterParams', () => {
  it('writes only what differs from the defaults', () => {
    expect(memberFilterParams(EMPTY_MEMBER_FILTERS).toString()).toBe('')
    expect(memberFilterParams(f({ role: 'teacher', sort: 'joined', dir: 'desc' }), { page: '2' }).toString())
      .toBe('role=teacher&sort=joined&dir=desc&page=2')
  })

  it('round-trips through parseMemberFilters', () => {
    const filters = f({ q: 'ng', tier: 'none', school: 'Lincoln High', joinedFrom: '2026-01-01', sort: 'email', dir: 'desc' })
    expect(parseMemberFilters(Object.fromEntries(memberFilterParams(filters)))).toEqual(filters)
  })

  it('does not count sorting as a filter', () => {
    expect(activeMemberFilterCount(f({ sort: 'joined', dir: 'desc' }))).toBe(0)
    expect(activeMemberFilterCount(f({ role: 'mentor', email: 'x' }))).toBe(2)
  })
})

describe('applyMemberFilters', () => {
  it('needs every word of a name filter to match the first or last name', () => {
    const q = applyMemberFilters(new Recorder(), f({ name: 'ava ng' }))
    expect(q.calls).toEqual([
      'or first_name.ilike.%ava%,last_name.ilike.%ava%',
      'or first_name.ilike.%ng%,last_name.ilike.%ng%',
    ])
  })

  it('filters a tier through the aliased embed, so the displayed memberships stay whole', () => {
    expect(memberFilterEmbeds(f({ tier: TIER }))).toBe(', tier_f:member_memberships!inner(id)')
    expect(applyMemberFilters(new Recorder(), f({ tier: TIER })).calls)
      .toEqual(['eq tier_f.renewal_status active', `eq tier_f.tier_id ${TIER}`])
  })

  it('finds members with no active membership with an anti-join', () => {
    expect(memberFilterEmbeds(f({ tier: 'none' }))).toBe(', tier_f:member_memberships(id)')
    expect(applyMemberFilters(new Recorder(), f({ tier: 'none' })).calls)
      .toEqual(['eq tier_f.renewal_status active', 'is tier_f null'])
  })

  it('matches the current school only', () => {
    expect(memberFilterEmbeds(f({ school: 'lin' }))).toBe(', school_f:member_schools!inner(id, schools!inner(id))')
    expect(applyMemberFilters(new Recorder(), f({ school: 'lin' })).calls)
      .toEqual(['eq school_f.is_current true', 'ilike school_f.schools.name %lin%'])
  })

  it('reads joined dates as whole days in Mountain time, inclusive of the end day', () => {
    // 29 Oct 2026 is MDT (UTC-6); 1 Dec 2026 is MST (UTC-7).
    expect(applyMemberFilters(new Recorder(), f({ joinedFrom: '2026-10-29', joinedTo: '2026-12-01' })).calls).toEqual([
      'gte created_at 2026-10-29T06:00:00.000Z',
      'lt created_at 2026-12-02T07:00:00.000Z',
    ])
  })

  it('adds nothing when no filter is set', () => {
    expect(applyMemberFilters(new Recorder(), EMPTY_MEMBER_FILTERS).calls).toEqual([])
    expect(memberFilterEmbeds(EMPTY_MEMBER_FILTERS)).toBe('')
  })
})

describe('applyMemberSort', () => {
  it('sorts by name by default and breaks ties by name otherwise', () => {
    expect(applyMemberSort(new Recorder(), EMPTY_MEMBER_FILTERS).calls).toEqual(['order last_name asc', 'order first_name asc'])
    expect(applyMemberSort(new Recorder(), f({ sort: 'joined', dir: 'desc' })).calls)
      .toEqual(['order created_at desc', 'order last_name asc', 'order first_name asc'])
  })
})
