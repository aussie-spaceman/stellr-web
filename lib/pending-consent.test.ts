// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Decision 24 (3 Nov 2026): minors register themselves, by age band, with a
// parent or guardian's consent and a 30-day purge.

const { state } = vi.hoisted(() => ({
  state: {
    /** Members whose guardian agreement is complete. */
    consented: new Set<string>(),
    /** Members with an in-flight minor agreement, and whether the guardian signed it. */
    inFlight: new Map<string, { guardianSigned: boolean }>(),
    pending: [] as Array<Record<string, unknown>>,
    writes: [] as Array<{ table: string; op: string; payload: unknown }>,
  },
}))

vi.mock('@/lib/guardian-consent', () => ({
  guardianAgreementOnFile: async (_db: unknown, who: { memberId: string }) => state.consented.has(who.memberId),
}))
vi.mock('@/lib/activity-log', () => ({ logActivity: async () => {} }))

const { ageBand, isKnownUnder13, minorSelfSignupEnabled, openPendingConsent, purgeUnconsentedAccounts, purgeAfter, PENDING_CONSENT_DAYS } =
  await import('./pending-consent')
const { appToday } = await import('@/lib/age')

/** A date of birth `n` years before the app's today, less `extraDays`. */
const yearsAgo = (n: number, extraDays = 0) => {
  const d = appToday()
  d.setUTCFullYear(d.getUTCFullYear() - n)
  d.setUTCDate(d.getUTCDate() - extraDays)
  return d.toISOString().slice(0, 10)
}
/** The day before the `n`th birthday: still n - 1. */
const dayBeforeBirthday = (n: number) => {
  const d = appToday()
  d.setUTCFullYear(d.getUTCFullYear() - n)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function fakeDb() {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {}
      let op = 'select'
      let payload: unknown = null
      const rows = () => {
        if (table === 'member_pending_consent') {
          return state.pending.filter((r) =>
            (filters.member_id === undefined || r.member_id === filters.member_id) &&
            (filters.consented_null !== true || r.consented_at == null) &&
            (filters.lte === undefined || String(r.purge_after) <= String(filters.lte)))
        }
        if (table === 'agreements') {
          const id = filters.member_id as string
          return state.inFlight.has(id) ? [{ id: `agr-${id}` }] : []
        }
        return []
      }
      const result = () => {
        if (op === 'update' || op === 'insert') {
          state.writes.push({ table, op, payload })
          if (table === 'member_pending_consent' && op === 'insert') state.pending.push(payload as Record<string, unknown>)
          if (table === 'member_pending_consent' && op === 'update') {
            const hit = rows()
            for (const r of hit) Object.assign(r, payload)
            return { data: hit.map((r) => ({ member_id: r.member_id })), error: null }
          }
          return { data: null, error: null }
        }
        if (table === 'agreement_recipients') {
          const ids = (filters.in as string[]) ?? []
          const n = ids.filter((id) => state.inFlight.get(id.replace('agr-', ''))?.guardianSigned).length
          return { count: n, error: null }
        }
        return { data: rows(), error: null }
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        insert: (p: unknown) => { op = 'insert'; payload = p; return chain },
        update: (p: unknown) => { op = 'update'; payload = p; return chain },
        eq: (c: string, v: unknown) => { filters[c] = v; return chain },
        is: (c: string, v: unknown) => { if (c === 'consented_at' && v === null) filters.consented_null = true; return chain },
        lte: (_c: string, v: unknown) => { filters.lte = v; return chain },
        in: (c: string, v: unknown) => { if (c === 'envelope_row') filters.in = v; return chain },
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (f: (v: unknown) => unknown) => Promise.resolve(result()).then(f),
      }
      return chain
    },
  }
}

beforeEach(() => {
  state.consented = new Set()
  state.inFlight = new Map()
  state.pending = []
  state.writes = []
})

describe('ageBand — every band, on the day', () => {
  it('12 is a child; 13, 15 and 17 are teens; 18 is an adult', () => {
    expect(ageBand(yearsAgo(12))).toBe('child')
    expect(ageBand(dayBeforeBirthday(13))).toBe('child')
    expect(ageBand(yearsAgo(13))).toBe('teen')
    expect(ageBand(yearsAgo(15))).toBe('teen')
    expect(ageBand(yearsAgo(17))).toBe('teen')
    expect(ageBand(dayBeforeBirthday(18))).toBe('teen')
    expect(ageBand(yearsAgo(18))).toBe('adult')
  })

  it('fails closed: an unknown or invalid date of birth is a child', () => {
    for (const dob of [null, undefined, '', 'not a date', '2999-01-01', '2010-13-45']) {
      expect(ageBand(dob as string | null), String(dob)).toBe('child')
    }
  })

  it('isKnownUnder13 reads only a usable date', () => {
    expect(isKnownUnder13(yearsAgo(12))).toBe(true)
    expect(isKnownUnder13(yearsAgo(13))).toBe(false)
    expect(isKnownUnder13(null)).toBe(false)
  })
})

describe('MINOR_SELF_SIGNUP_ENABLED', () => {
  const before = process.env.MINOR_SELF_SIGNUP_ENABLED
  afterEach(() => { process.env.MINOR_SELF_SIGNUP_ENABLED = before })

  it('is off unless set to exactly "true"', () => {
    delete process.env.MINOR_SELF_SIGNUP_ENABLED
    expect(minorSelfSignupEnabled()).toBe(false)
    process.env.MINOR_SELF_SIGNUP_ENABLED = '1'
    expect(minorSelfSignupEnabled()).toBe(false)
    process.env.MINOR_SELF_SIGNUP_ENABLED = 'true'
    expect(minorSelfSignupEnabled()).toBe(true)
  })
})

describe('openPendingConsent', () => {
  it('starts a 30-day clock that a later update never restarts', async () => {
    const db = fakeDb() as never
    const t0 = new Date('2026-11-03T12:00:00Z')
    await openPendingConsent(db, { memberId: 'm1', band: 'teen', guardianName: 'Pat Lee', guardianEmail: 'Pat@Example.test', now: t0 })
    expect(state.pending[0]).toMatchObject({ member_id: 'm1', guardian_email: 'pat@example.test', purge_after: purgeAfter(t0) })
    expect(new Date(purgeAfter(t0)).getTime() - t0.getTime()).toBe(PENDING_CONSENT_DAYS * 86_400_000)

    await openPendingConsent(db, { memberId: 'm1', band: 'teen', guardianName: 'Pat Lee', guardianEmail: 'other@example.test', now: new Date('2026-11-20T00:00:00Z') })
    expect(state.pending).toHaveLength(1)
    expect(state.pending[0]).toMatchObject({ guardian_email: 'other@example.test', purge_after: purgeAfter(t0) })
  })
})

describe('purgeUnconsentedAccounts — the 30-day purge', () => {
  const now = new Date('2026-12-10T00:00:00Z')
  const row = (member_id: string, purge_after: string, consented_at: string | null = null) =>
    ({ member_id, band: 'teen', guardian_email: 'g@example.test', purge_after, consented_at })

  it('deletes overdue unconsented accounts through the registry, and nothing else', async () => {
    state.pending = [
      row('overdue', '2026-12-01T00:00:00Z'),
      row('not-yet', '2026-12-20T00:00:00Z'),
      row('consented-long-ago', '2026-11-01T00:00:00Z', '2026-10-15T00:00:00Z'),
    ]
    const deleted: string[] = []
    const r = await purgeUnconsentedAccounts(fakeDb() as never, { now, deleteMember: async (id) => { deleted.push(id) } })
    expect(deleted).toEqual(['overdue'])
    expect(r).toMatchObject({ scanned: 1, purged: ['overdue'], cleared: [], heldGuardianSigned: [], errors: [] })
  })

  it('clears instead of purging when the agreement completed and the hook missed it', async () => {
    state.pending = [row('late-consent', '2026-12-01T00:00:00Z')]
    state.consented.add('late-consent')
    const deleteMember = vi.fn()
    const r = await purgeUnconsentedAccounts(fakeDb() as never, { now, deleteMember })
    expect(deleteMember).not.toHaveBeenCalled()
    expect(r.cleared).toEqual(['late-consent'])
    expect(state.pending[0].consented_at).toBeTruthy()
  })

  it('never purges an account whose guardian has signed but the member has not', async () => {
    state.pending = [row('half-signed', '2026-12-01T00:00:00Z'), row('unsigned', '2026-12-01T00:00:00Z')]
    state.inFlight.set('half-signed', { guardianSigned: true })
    state.inFlight.set('unsigned', { guardianSigned: false })
    const deleted: string[] = []
    const r = await purgeUnconsentedAccounts(fakeDb() as never, { now, deleteMember: async (id) => { deleted.push(id) } })
    expect(deleted).toEqual(['unsigned'])
    expect(r.heldGuardianSigned).toEqual(['half-signed'])
  })

  it('records a failed delete and carries on with the rest', async () => {
    state.pending = [row('a', '2026-12-01T00:00:00Z'), row('b', '2026-12-02T00:00:00Z')]
    const r = await purgeUnconsentedAccounts(fakeDb() as never, {
      now,
      deleteMember: async (id) => { if (id === 'a') throw new Error('blocked') },
    })
    expect(r.purged).toEqual(['b'])
    expect(r.errors).toEqual([{ memberId: 'a', error: 'blocked' }])
  })

  it('uses the archive-free registry entity that runs as a member, Clerk login included', async () => {
    const { getEntityDef } = await import('@/lib/deletion/registry')
    const def = getEntityDef('pending_consent_member')
    expect(def).toMatchObject({ table: 'members', actsAs: 'member', archive: false, softDelete: null })
    expect(def?.external).toEqual(expect.arrayContaining(['clerk', 'docusign', 'stripe']))
  })
})
