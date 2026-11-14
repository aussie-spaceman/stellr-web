// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

vi.mock('@/lib/env', () => ({ SITE_URL: 'https://www.stellreducation.org' }))
// Only agreementValid is needed, and it is pure: a completed agreement lasts 3 years.
vi.mock('@/lib/docusign-agreements', () => ({
  agreementValid: (row: { completed_at: string | null }, now = new Date()) => {
    if (!row.completed_at) return false
    const d = new Date(row.completed_at)
    d.setFullYear(d.getFullYear() + 3)
    return d > now
  },
}))

import { sweepMinorCredentialPages } from './credential-minor-sweep'
import { schoolYearOf } from './credentials'

// ── An in-memory double for the reads and the one write the sweep makes ─────

interface Person {
  date_of_birth?: string | null
  grade?: string | null
  age_bracket?: string | null
  updated_at?: string | null
  /** The member's current school's state. */
  state?: string | null
}
interface Cred {
  id: string
  member_id: string | null
  participant_id: string | null
  is_minor: boolean
  visibility: 'public' | 'private'
  tombstoned_at: string | null
  tenant_id: string | null
}
interface World {
  members: Record<string, Person>
  /** Completed minor agreements by member id: true = the guardian opted out. */
  consent: Record<string, { optOut: boolean }>
  credentials: Cred[]
  /** Member ids whose record reads fail. */
  failingMembers?: Set<string>
  listingError?: boolean
  writeError?: boolean
}

type Filter = (r: Record<string, unknown>) => boolean

function orFilter(expr: string): Filter {
  const parts = expr.split(',').map((c) => {
    const [col, op, ...rest] = c.split('.')
    const v = rest.join('.')
    return op === 'is' ? (r: Record<string, unknown>) => (r[col] ?? null) === null
      : (r: Record<string, unknown>) => r[col] === v
  })
  return (r) => parts.some((p) => p(r))
}

function makeDb(w: World) {
  const writes: { or: string[] }[] = []
  const listings: number[] = []
  const db = {
    from(table: string) {
      const filters: Filter[] = []
      const ors: string[] = []
      let eqId: string | null = null
      let payload: Record<string, unknown> | null = null
      let limit = Infinity
      const q: Record<string, unknown> = {}
      Object.assign(q, {
        select: (_cols?: string) => (payload ? write() : q),
        update: (p: Record<string, unknown>) => { payload = p; return q },
        eq: (k: string, v: unknown) => { if (k === 'id' || k === 'member_id') eqId = String(v); filters.push((r) => r[k] === v); return q },
        is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return q },
        gt: (k: string, v: string) => { filters.push((r) => String(r[k]) > v); return q },
        or: (expr: string) => { ors.push(expr); filters.push(orFilter(expr)); return q },
        order: () => q,
        limit: (n: number) => {
          limit = n
          if (table === 'member_schools') return memberSchools()
          if (table === 'credentials') return listing()
          return q
        },
        maybeSingle: async () => single(),
      })

      async function listing() {
        if (w.listingError) return { data: null, error: { message: 'listing failed' } }
        const rows = w.credentials.filter((r) => filters.every((f) => f(r as unknown as Record<string, unknown>)))
          .sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, limit)
        listings.push(rows.length)
        return { data: rows.map(({ id, member_id, participant_id, is_minor }) => ({ id, member_id, participant_id, is_minor })), error: null }
      }
      async function write() {
        writes.push({ or: [...ors] })
        if (w.writeError) return { data: null, error: { message: 'write failed' } }
        const hit = w.credentials.filter((r) => filters.every((f) => f(r as unknown as Record<string, unknown>)))
        for (const r of hit) Object.assign(r, payload)
        return { data: hit, error: null }
      }
      async function memberSchools() {
        const id = eqId ?? ''
        if (w.failingMembers?.has(id)) return { data: null, error: { message: 'down' } }
        const st = w.members[id]?.state
        return { data: st === undefined ? [] : [{ is_current: true, schools: { state: st } }], error: null }
      }
      async function single() {
        if (table === 'members') {
          const id = eqId ?? ''
          if (w.failingMembers?.has(id)) return { data: null, error: { message: 'down' } }
          const p = w.members[id]
          return { data: p ? { date_of_birth: p.date_of_birth ?? null, grade: p.grade ?? null, age_bracket: p.age_bracket ?? 'unknown', updated_at: p.updated_at ?? null } : null, error: null }
        }
        if (table === 'participants') return { data: null, error: null }
        if (table === 'agreements') {
          const m = /member_id\.eq\.([^,]+)/.exec(ors[0] ?? '')
          const c = m ? w.consent[m[1]] : undefined
          return { data: c ? { id: 'a1', completed_at: new Date().toISOString(), envelope_type: 'minor', credential_sharing_opt_out: c.optOut, reused_from: null } : null, error: null }
        }
        return { data: null, error: null }
      }
      return q
    },
  }
  return { db: db as unknown as Parameters<typeof sweepMinorCredentialPages>[0], writes, listings }
}

function bornYearsAgo(years: number): string {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - years)
  d.setUTCMonth(d.getUTCMonth() - 3)
  return d.toISOString().slice(0, 10)
}

const lastSchoolYear = `${schoolYearOf(new Date()) - 1}-09-15T00:00:00Z`
const thisSchoolYear = new Date().toISOString()

function cred(id: string, memberId: string, over: Partial<Cred> = {}): Cred {
  return { id, member_id: memberId, participant_id: null, is_minor: false, visibility: 'public', tombstoned_at: null, tenant_id: STELLR_TENANT_ID, ...over }
}
const visibility = (w: World, id: string) => w.credentials.find((c) => c.id === id)?.visibility

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('sweepMinorCredentialPages', () => {
  it('makes private a public page of an 18-year-old at a Nebraska school with no consent', async () => {
    const w: World = {
      members: { m1: { date_of_birth: bornYearsAgo(18), state: 'NE' } },
      consent: {},
      credentials: [cred('c1', 'm1'), cred('c2', 'm1', { tenant_id: null })],
    }
    const { db } = makeDb(w)
    const out = await sweepMinorCredentialPages(db)
    expect(out).toEqual({ scanned: 2, checked: 1, holdersUnpublished: 1, unpublished: 2, errors: 0, truncated: false })
    expect(visibility(w, 'c1')).toBe('private')
    expect(visibility(w, 'c2')).toBe('private')
  })

  it('leaves an adult alone', async () => {
    const w: World = {
      members: { m1: { date_of_birth: bornYearsAgo(30), state: 'CO' }, m2: { date_of_birth: bornYearsAgo(19), state: 'NE' } },
      consent: {},
      credentials: [cred('c1', 'm1'), cred('c2', 'm2')],
    }
    const { db, writes } = makeDb(w)
    const out = await sweepMinorCredentialPages(db)
    expect(out).toMatchObject({ checked: 2, unpublished: 0, errors: 0 })
    expect(writes).toHaveLength(0)
    expect(visibility(w, 'c1')).toBe('public')
  })

  it('leaves a Minor whose guardian consented alone, and takes down one who opted out', async () => {
    const w: World = {
      members: { m1: { date_of_birth: bornYearsAgo(16) }, m2: { date_of_birth: bornYearsAgo(16) } },
      consent: { m1: { optOut: false }, m2: { optOut: true } },
      credentials: [cred('c1', 'm1'), cred('c2', 'm2')],
    }
    const { db } = makeDb(w)
    const out = await sweepMinorCredentialPages(db)
    expect(out).toMatchObject({ checked: 2, holdersUnpublished: 1, unpublished: 1 })
    expect(visibility(w, 'c1')).toBe('public')
    expect(visibility(w, 'c2')).toBe('private')
  })

  it('takes down an under-13 page whatever the consent says', async () => {
    const w: World = {
      members: { m1: { date_of_birth: bornYearsAgo(11) } },
      consent: { m1: { optOut: false } },
      credentials: [cred('c1', 'm1', { is_minor: true })],
    }
    const { db } = makeDb(w)
    expect(await sweepMinorCredentialPages(db)).toMatchObject({ unpublished: 1 })
  })

  describe('legal-credential-family-link.5: a date of birth against a stale grade', () => {
    it('a grade from an earlier school year does not make an adult a Minor: the DOB decides', async () => {
      const w: World = {
        members: { m1: { date_of_birth: bornYearsAgo(25), state: 'CO', grade: 'grade_12', age_bracket: 'high_school', updated_at: lastSchoolYear } },
        consent: {},
        credentials: [cred('c1', 'm1')],
      }
      const { db } = makeDb(w)
      expect(await sweepMinorCredentialPages(db)).toMatchObject({ unpublished: 0 })
      expect(visibility(w, 'c1')).toBe('public')
    })

    it('a grade recorded this school year still counts: still in school is a Minor', async () => {
      const w: World = {
        members: { m1: { date_of_birth: bornYearsAgo(18), state: 'CO', grade: 'grade_12', updated_at: thisSchoolYear } },
        consent: {},
        credentials: [cred('c1', 'm1')],
      }
      const { db } = makeDb(w)
      expect(await sweepMinorCredentialPages(db)).toMatchObject({ unpublished: 1 })
    })

    it('with no DOB, a stale grade is unknown, and unknown fails closed: private', async () => {
      const w: World = {
        members: { m1: { date_of_birth: null, grade: 'grade_12', updated_at: lastSchoolYear } },
        consent: { m1: { optOut: false } },
        credentials: [cred('c1', 'm1')],
      }
      const { db } = makeDb(w)
      expect(await sweepMinorCredentialPages(db)).toMatchObject({ unpublished: 1 })
      expect(visibility(w, 'c1')).toBe('private')
    })
  })

  it('is idempotent: a second run finds nothing to change', async () => {
    const w: World = {
      members: { m1: { date_of_birth: bornYearsAgo(20), state: 'MS' }, m2: { date_of_birth: bornYearsAgo(40) } },
      consent: {},
      credentials: [cred('c1', 'm1'), cred('c2', 'm2')],
    }
    const { db, writes } = makeDb(w)
    expect(await sweepMinorCredentialPages(db)).toMatchObject({ scanned: 2, unpublished: 1 })
    expect(await sweepMinorCredentialPages(db)).toEqual({ scanned: 1, checked: 1, holdersUnpublished: 0, unpublished: 0, errors: 0, truncated: false })
    expect(writes).toHaveLength(1)
  })

  it('reads Stellr’s public, live pages only, and writes within Stellr’s scope', async () => {
    const w: World = {
      members: { m1: { date_of_birth: bornYearsAgo(16) } },
      consent: {},
      credentials: [
        cred('c1', 'm1', { tenant_id: '00000000-0000-4000-8000-00000000c0de' }),
        cred('c2', 'm1', { visibility: 'private' }),
        cred('c3', 'm1', { tombstoned_at: '2026-10-01T00:00:00Z' }),
      ],
    }
    const { db, writes } = makeDb(w)
    expect(await sweepMinorCredentialPages(db)).toMatchObject({ scanned: 0, checked: 0, unpublished: 0 })
    expect(writes).toHaveLength(0)
    expect(visibility(w, 'c1')).toBe('public')

    w.credentials.push(cred('c4', 'm1'))
    await sweepMinorCredentialPages(db)
    expect(writes[0].or).toContain(`tenant_id.eq.${STELLR_TENANT_ID},tenant_id.is.null`)
    expect(visibility(w, 'c1')).toBe('public')
    expect(visibility(w, 'c4')).toBe('private')
  })

  it('skips a holder it cannot read, counts the error, and unpublishes nothing on a guess', async () => {
    const w: World = {
      members: { m1: { date_of_birth: bornYearsAgo(16) }, m2: { date_of_birth: bornYearsAgo(16) } },
      consent: {},
      credentials: [cred('c1', 'm1'), cred('c2', 'm2')],
      failingMembers: new Set(['m1']),
    }
    const { db } = makeDb(w)
    expect(await sweepMinorCredentialPages(db)).toMatchObject({ checked: 2, errors: 1, unpublished: 1 })
    expect(visibility(w, 'c1')).toBe('public')
  })

  it('counts a failed write as an error', async () => {
    const w: World = {
      members: { m1: { date_of_birth: bornYearsAgo(16) } }, consent: {}, credentials: [cred('c1', 'm1')], writeError: true,
    }
    const { db } = makeDb(w)
    expect(await sweepMinorCredentialPages(db)).toMatchObject({ errors: 1, unpublished: 0 })
  })

  it('throws when the listing fails, so the cron records it', async () => {
    const { db } = makeDb({ members: {}, consent: {}, credentials: [], listingError: true })
    await expect(sweepMinorCredentialPages(db)).rejects.toThrow(/listing public credentials failed/)
  })

  it('checks each holder once, across pages', async () => {
    const w: World = {
      members: { m1: { date_of_birth: bornYearsAgo(40) }, m2: { date_of_birth: bornYearsAgo(40) } },
      consent: {},
      credentials: [cred('c1', 'm1'), cred('c2', 'm1'), cred('c3', 'm2'), cred('c4', 'm1'), cred('c5', 'm2')],
    }
    const { db, listings } = makeDb(w)
    expect(await sweepMinorCredentialPages(db, { pageSize: 2 })).toMatchObject({ scanned: 5, checked: 2, truncated: false })
    expect(listings).toEqual([2, 2, 1])
  })

  it('is bounded per run, and says when it stopped early', async () => {
    const w: World = {
      members: { m1: { date_of_birth: bornYearsAgo(16) }, m2: { date_of_birth: bornYearsAgo(16) }, m3: { date_of_birth: bornYearsAgo(16) } },
      consent: {},
      credentials: [cred('c1', 'm1'), cred('c2', 'm2'), cred('c3', 'm3')],
    }
    const { db } = makeDb(w)
    expect(await sweepMinorCredentialPages(db, { maxHolders: 2, concurrency: 5 })).toMatchObject({ checked: 2, unpublished: 2, truncated: true })
    expect(visibility(w, 'c3')).toBe('public')

    let t = 0
    const timed = makeDb({ ...w, credentials: [cred('d1', 'm1'), cred('d2', 'm2')] })
    expect(await sweepMinorCredentialPages(timed.db, { budgetMs: 10, concurrency: 1, now: () => (t += 20) })).toMatchObject({ checked: 0, truncated: true })
  })

  it('logs counts only: no ids, names or dates of birth', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const w: World = { members: { m1: { date_of_birth: bornYearsAgo(16) } }, consent: {}, credentials: [cred('c1', 'm1')] }
    await sweepMinorCredentialPages(makeDb(w).db)
    const text = log.mock.calls.flat().join(' ')
    expect(text).toMatch(/made 1 page\(s\) private for 1 holder\(s\)/)
    expect(text).not.toMatch(/m1|c1|\d{4}-\d{2}-\d{2}/)
  })
})
