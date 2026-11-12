import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveSchoolIds } from './school-ids'

// A fake client that answers the two queries resolveSchoolIds makes:
// member_schools by member_id (current only), and schools by an or= of
// exact-name ilike patterns. It applies ilike as PostgREST would for a
// pattern with no unescaped wildcards: a case-insensitive equality.
function fakeDb(memberSchools: { member_id: string; school_id: string; is_current: boolean }[], schools: { id: string; name: string }[]) {
  const calls: { table: string; or?: string }[] = []
  const db = {
    from(table: string) {
      const filters: { eq?: [string, unknown]; in?: [string, string[]]; or?: string } = {}
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => ((filters.eq = [c, v]), q),
        in: (c: string, v: string[]) => ((filters.in = [c, v]), q),
        or: (f: string) => ((filters.or = f), q),
        then: (resolve: (r: { data: unknown[]; error: null }) => void) => {
          calls.push({ table, or: filters.or })
          if (table === 'member_schools') {
            const ids = filters.in?.[1] ?? []
            resolve({ data: memberSchools.filter((r) => r.is_current && ids.includes(r.member_id)), error: null })
            return
          }
          const wanted = [...(filters.or ?? '').matchAll(/name\.ilike\."((?:[^"\\]|\\.)*)"/g)].map((m) =>
            m[1].replace(/\\(.)/g, '$1').replace(/\\(.)/g, '$1').toLowerCase(),
          )
          resolve({ data: schools.filter((s) => wanted.includes(s.name.toLowerCase())), error: null })
        },
      }
      return q
    },
  }
  return { db: db as unknown as SupabaseClient, calls }
}

describe('resolveSchoolIds', () => {
  it("prefers the member's one current school over the typed name", async () => {
    const { db } = fakeDb(
      [{ member_id: 'm1', school_id: 's-current', is_current: true }],
      [{ id: 's-typed', name: 'Typed High' }],
    )
    expect(await resolveSchoolIds(db, [{ memberId: 'm1', schoolName: 'Typed High' }])).toEqual(['s-current'])
  })

  it('falls back to an exact name match, ignoring case and extra spaces', async () => {
    const { db } = fakeDb([], [{ id: 's1', name: 'Alta High School' }])
    expect(await resolveSchoolIds(db, [{ memberId: 'm9', schoolName: '  alta   high school ' }])).toEqual(['s1'])
  })

  it('links nothing when two schools share the name, or a member has two current schools', async () => {
    const { db } = fakeDb(
      [
        { member_id: 'm1', school_id: 'a', is_current: true },
        { member_id: 'm1', school_id: 'b', is_current: true },
      ],
      [
        { id: 'x1', name: 'Lincoln High School' },
        { id: 'x2', name: 'Lincoln High School' },
      ],
    )
    expect(await resolveSchoolIds(db, [{ memberId: 'm1', schoolName: 'Lincoln High School' }])).toEqual([null])
  })

  it('treats % and _ in a typed name literally, not as wildcards', async () => {
    const { db, calls } = fakeDb([], [{ id: 's1', name: 'St_Mary 100%' }])
    expect(await resolveSchoolIds(db, [{ schoolName: 'St_Mary 100%' }])).toEqual(['s1'])
    expect(calls.find((c) => c.table === 'schools')?.or).toBe('name.ilike."St\\\\_Mary 100\\\\%"')
  })

  it('returns null for rows with no school and makes no queries for an empty list', async () => {
    const { db, calls } = fakeDb([], [])
    expect(await resolveSchoolIds(db, [])).toEqual([])
    expect(calls).toHaveLength(0)
    expect(await resolveSchoolIds(db, [{ memberId: null, schoolName: null }])).toEqual([null])
  })
})
