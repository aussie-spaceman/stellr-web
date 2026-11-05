import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/activity-log', () => ({ logActivity: async () => {} }))

const { resolveAndLinkSchool } = await import('./school-link')

const SCHOOL = '11111111-1111-4111-8111-111111111111'

// A fake client: reads of `schools` answer from `school`; every other read finds
// nothing, and every read, insert and upsert is recorded.
function makeDb(school: { data: unknown; error: unknown }) {
  const ors: string[] = []
  const inserts: string[] = []
  const links: unknown[] = []
  const reads: string[] = []
  const from = (table: string) => {
    const chain: Record<string, unknown> = {
      select: () => { reads.push(table); return chain },
      eq: () => chain,
      in: () => chain,
      ilike: () => chain,
      limit: () => chain,
      or: (s: string) => { ors.push(s); return chain },
      insert: () => { inserts.push(table); return chain },
      upsert: (p: unknown) => { links.push(p); return chain },
      single: async () => ({ data: { id: 'created' }, error: null }),
      maybeSingle: async () => (table === 'schools' ? school : { data: null, error: null }),
      then: (onDone: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(onDone),
    }
    return chain
  }
  return { db: { from } as unknown as SupabaseClient, ors, inserts, links, reads }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('resolveAndLinkSchool — a picked school id', () => {
  it('links an active school, filtered as the picker filters', async () => {
    const t = makeDb({ data: { id: SCHOOL, state: 'CO' }, error: null })
    expect(await resolveAndLinkSchool(t.db, ['m-1'], { id: SCHOOL, name: 'Denver High' })).toEqual({ id: SCHOOL, state: 'CO' })
    expect(t.ors).toContain('is_active.is.null,is_active.eq.true')
    expect(t.links).toHaveLength(1)
    expect(t.inserts).toEqual([])
  })

  it('an id that does not resolve links nothing, and does not fall back to the name', async () => {
    const t = makeDb({ data: null, error: null })
    expect(await resolveAndLinkSchool(t.db, ['m-1'], { id: SCHOOL, name: 'Denver High' })).toBeNull()
    expect(t.links).toEqual([])
    expect(t.inserts).toEqual([])
  })

  it('an id that is not a uuid is never sent to the database', async () => {
    const t = makeDb({ data: { id: SCHOOL }, error: null })
    expect(await resolveAndLinkSchool(t.db, ['m-1'], { id: 'not-a-uuid', name: 'Denver High' })).toBeNull()
    expect(t.reads).toEqual([])
    expect(t.links).toEqual([])
  })

  it('a failed read links nothing, and the registration carries on', async () => {
    const t = makeDb({ data: null, error: { message: 'boom' } })
    expect(await resolveAndLinkSchool(t.db, ['m-1'], { id: SCHOOL, name: 'Denver High' })).toBeNull()
    expect(t.links).toEqual([])
  })
})
