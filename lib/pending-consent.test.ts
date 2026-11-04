// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Decision 24 (3 Nov 2026): minors register themselves, by age band, with a
// parent or guardian's consent and a 30-day purge.

const { state } = vi.hoisted(() => ({
  state: {
    /** Members (or participant ids) whose guardian agreement is complete. */
    consented: new Set<string>(),
    /** Members with an in-flight minor agreement, and whether the guardian signed it. */
    inFlight: new Map<string, { guardianSigned: boolean }>(),
    pending: [] as Array<Record<string, unknown>>,
    /** member id → their participant row ids. */
    participants: new Map<string, string[]>(),
    /** Members an admin invited. */
    invited: new Set<string>(),
    /** Members with a minor EVENT form (not the membership one). */
    eventForms: new Set<string>(),
    /** Tables whose reads fail. */
    failing: new Set<string>(),
    writes: [] as Array<{ table: string; op: string; payload: unknown; memberId?: unknown }>,
    /** Scopes guardianAgreementOnFile was asked about. */
    scopes: [] as Array<{ memberId?: string; participantIds?: string[] }>,
  },
}))

vi.mock('@/lib/guardian-consent', () => ({
  guardianAgreementOnFile: async (_db: unknown, who: { memberId: string; participantIds?: string[] }) => {
    state.scopes.push(who)
    return state.consented.has(who.memberId) || (who.participantIds ?? []).some((p) => state.consented.has(p))
  },
}))
vi.mock('@/lib/activity-log', () => ({ logActivity: async () => {} }))

const {
  ageBand, isKnownUnder13, minorSelfSignupEnabled, openPendingConsent, openScreenedRequest, purgeUnconsentedAccounts,
  purgeAfter, readPendingConsent, getPendingConsent, settlePendingConsent, guardianHasSigned, adultRouteForMinor,
  childAwaitingConsent, PENDING_CONSENT_DAYS, PURGE_BATCH,
} = await import('./pending-consent')
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
      let head = false
      const failed = () => state.failing.has(table)
      const pendingRows = () => {
        const nowIso = filters.lte as string | undefined
        let rows = state.pending.filter((r) =>
          (filters.member_id === undefined || r.member_id === filters.member_id) &&
          (filters.consented_null !== true || r.consented_at == null) &&
          (nowIso === undefined || String(r.purge_after) <= nowIso) &&
          (filters.retryDue === undefined || r.next_attempt_at == null || String(r.next_attempt_at) <= String(filters.retryDue)))
        if (filters.ordered) {
          rows = [...rows].sort((a, b) => {
            const an = a.next_attempt_at == null ? '' : String(a.next_attempt_at)
            const bn = b.next_attempt_at == null ? '' : String(b.next_attempt_at)
            return an === bn ? String(a.purge_after).localeCompare(String(b.purge_after)) : an.localeCompare(bn)
          })
        }
        return typeof filters.limit === 'number' ? rows.slice(0, filters.limit) : rows
      }
      const result = () => {
        if (failed()) return { data: null, count: null, error: { message: `${table} read failed` } }
        if (op === 'update' || op === 'insert') {
          state.writes.push({ table, op, payload, memberId: filters.member_id })
          if (table === 'member_pending_consent' && op === 'insert') state.pending.push({ ...(payload as Record<string, unknown>) })
          if (table === 'member_pending_consent' && op === 'update') {
            const hit = pendingRows()
            for (const r of hit) Object.assign(r, payload)
            return { data: hit.map((r) => ({ member_id: r.member_id })), error: null }
          }
          return { data: null, error: null }
        }
        if (table === 'member_pending_consent') return { data: pendingRows(), error: null }
        if (table === 'participants') {
          const ids = state.participants.get(filters.member_id as string) ?? []
          return head ? { count: ids.length, error: null } : { data: ids.map((id) => ({ id })), error: null }
        }
        if (table === 'members') {
          return { data: { account_invite_sent_at: state.invited.has(filters.id as string) ? '2026-10-01' : null }, error: null }
        }
        if (table === 'agreements') {
          if (head) return { count: state.eventForms.has(filters.member_id as string) ? 1 : 0, error: null }
          const id = String(filters.or ?? '').match(/member_id\.eq\.([^,]+)/)?.[1] ?? ''
          return { data: state.inFlight.has(id) ? [{ id: `agr-${id}` }] : [], error: null }
        }
        if (table === 'agreement_recipients') {
          const ids = (filters.in as string[]) ?? []
          const n = ids.filter((id) => state.inFlight.get(id.replace('agr-', ''))?.guardianSigned).length
          return { count: n, error: null }
        }
        return { data: [], error: null }
      }
      const chain: Record<string, unknown> = {
        select: (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return chain },
        insert: (p: unknown) => { op = 'insert'; payload = p; return chain },
        update: (p: unknown) => { op = 'update'; payload = p; return chain },
        eq: (c: string, v: unknown) => { filters[c] = v; return chain },
        is: (c: string, v: unknown) => { if (c === 'consented_at' && v === null) filters.consented_null = true; return chain },
        lte: (_c: string, v: unknown) => { filters.lte = v; return chain },
        or: (f: string) => {
          const due = f.match(/next_attempt_at\.lte\.(.+)$/)?.[1]
          if (due) filters.retryDue = due
          else filters.or = f
          return chain
        },
        in: (c: string, v: unknown) => { if (c === 'envelope_row') filters.in = v; return chain },
        order: () => { filters.ordered = true; return chain },
        limit: (n: number) => { filters.limit = n; return chain },
        maybeSingle: async () => {
          const r = result() as { data: unknown; error: unknown }
          if (r.error) return r
          return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null }
        },
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
  state.participants = new Map()
  state.invited = new Set()
  state.eventForms = new Set()
  state.failing = new Set()
  state.writes = []
  state.scopes = []
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

describe('reading the pending state — never fails open', () => {
  it('a failed read is "unknown", and getPendingConsent throws rather than answering "none"', async () => {
    state.failing.add('member_pending_consent')
    expect(await readPendingConsent(fakeDb() as never, 'm1')).toEqual({ state: 'unknown' })
    await expect(getPendingConsent(fakeDb() as never, 'm1')).rejects.toThrow()
  })

  it('childAwaitingConsent: a pending child waits, a failed read waits, a teen or no row does not', async () => {
    state.pending = [
      { member_id: 'kid', band: 'child', guardian_email: null, consented_at: null },
      { member_id: 'teen', band: 'teen', guardian_email: 'g@example.test', consented_at: null },
    ]
    expect(await childAwaitingConsent(fakeDb() as never, 'kid')).toBe(true)
    expect(await childAwaitingConsent(fakeDb() as never, 'teen')).toBe(false)
    expect(await childAwaitingConsent(fakeDb() as never, 'nobody')).toBe(false)
    state.consented.add('kid')
    expect(await childAwaitingConsent(fakeDb() as never, 'kid')).toBe(false)
    state.failing.add('member_pending_consent')
    expect(await childAwaitingConsent(fakeDb() as never, 'anyone')).toBe(true)
  })
})

describe('openPendingConsent / openScreenedRequest', () => {
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

  it('the age screen opens a guardian-less row on the same clock, and the guardian step fills it in', async () => {
    const db = fakeDb() as never
    const t0 = new Date('2026-11-03T12:00:00Z')
    await openScreenedRequest(db, { memberId: 'kid', band: 'child', now: t0 })
    await openScreenedRequest(db, { memberId: 'kid', band: 'child', now: new Date('2026-11-10T00:00:00Z') })
    expect(state.pending).toEqual([expect.objectContaining({ member_id: 'kid', band: 'child', guardian_email: null, purge_after: purgeAfter(t0) })])
    await openPendingConsent(db, { memberId: 'kid', band: 'child', guardianName: null, guardianEmail: 'parent@example.test' })
    expect(state.pending[0]).toMatchObject({ guardian_email: 'parent@example.test', purge_after: purgeAfter(t0) })
  })

  it('refuses to open a second row over a failed read', async () => {
    state.failing.add('member_pending_consent')
    await expect(openScreenedRequest(fakeDb() as never, { memberId: 'kid', band: 'child' })).rejects.toThrow()
  })
})

describe('consent scope — member AND participant rows, as mayLinkLogin reads it', () => {
  it('settlePendingConsent sees a guardian form signed on a participant row with no member_id', async () => {
    state.pending = [{ member_id: 'm1', band: 'teen', guardian_email: 'g@example.test', consented_at: null }]
    state.participants.set('m1', ['p-1'])
    state.consented.add('p-1')
    expect(await settlePendingConsent(fakeDb() as never, 'm1')).toBe(true)
    expect(state.scopes.at(-1)).toEqual({ memberId: 'm1', participantIds: ['p-1'] })
    expect(state.pending[0].consented_at).toBeTruthy()
  })

  it('guardianHasSigned reads the same scope, and says yes when a read fails', async () => {
    state.participants.set('m1', ['p-1'])
    state.consented.add('p-1')
    expect(await guardianHasSigned(fakeDb() as never, 'm1')).toBe(true)
    expect(state.scopes.at(-1)).toEqual({ memberId: 'm1', participantIds: ['p-1'] })
    state.consented.clear()
    state.failing.add('participants')
    expect(await guardianHasSigned(fakeDb() as never, 'm1')).toBe(true)
  })
})

describe('adultRouteForMinor', () => {
  it('an invite, a participants row or an EVENT form is an adult route; the membership consent form is not', async () => {
    expect(await adultRouteForMinor(fakeDb() as never, 'self')).toBe('no')
    state.invited.add('inv')
    expect(await adultRouteForMinor(fakeDb() as never, 'inv')).toBe('yes')
    state.participants.set('evt', ['p-9'])
    expect(await adultRouteForMinor(fakeDb() as never, 'evt')).toBe('yes')
    state.eventForms.add('form')
    expect(await adultRouteForMinor(fakeDb() as never, 'form')).toBe('yes')
  })

  it('a failed read is unknown, never "no"', async () => {
    state.failing.add('participants')
    expect(await adultRouteForMinor(fakeDb() as never, 'x')).toBe('unknown')
  })
})

describe('purgeUnconsentedAccounts — the 30-day purge', () => {
  const now = new Date('2026-12-10T00:00:00Z')
  const row = (member_id: string, purge_after: string, consented_at: string | null = null) =>
    ({ member_id, band: 'teen', guardian_email: 'g@example.test', purge_after, consented_at, next_attempt_at: null })

  it('deletes overdue unconsented accounts through the registry, and nothing else', async () => {
    state.pending = [
      row('overdue', '2026-12-01T00:00:00Z'),
      row('not-yet', '2026-12-20T00:00:00Z'),
      row('consented-long-ago', '2026-11-01T00:00:00Z', '2026-10-15T00:00:00Z'),
    ]
    const deleted: string[] = []
    const r = await purgeUnconsentedAccounts(fakeDb() as never, { now, deleteMember: async (id) => { deleted.push(id) } })
    expect(deleted).toEqual(['overdue'])
    expect(r).toMatchObject({ scanned: 1, purged: ['overdue'], cleared: [], heldGuardianSigned: [], heldAdultRoute: [], errors: [] })
  })

  it('reaches a sign-up abandoned at the age screen (no guardian named)', async () => {
    state.pending = [{ ...row('screened-kid', '2026-12-01T00:00:00Z'), band: 'child', guardian_email: null }]
    const deleted: string[] = []
    await purgeUnconsentedAccounts(fakeDb() as never, { now, deleteMember: async (id) => { deleted.push(id) } })
    expect(deleted).toEqual(['screened-kid'])
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

  // Review finding: an event-registered or invited minor with a pending row
  // was deleted on day 30, voiding the event's guardian form with it.
  it('never purges a minor an adult route reaches (event registration, invite, event form), nor on a failed read', async () => {
    state.pending = [
      row('event-student', '2026-12-01T00:00:00Z'),
      row('invited', '2026-12-01T00:00:00Z'),
      row('event-form', '2026-12-01T00:00:00Z'),
    ]
    state.participants.set('event-student', ['p-1'])
    state.invited.add('invited')
    state.eventForms.add('event-form')
    const deleteMember = vi.fn()
    const r = await purgeUnconsentedAccounts(fakeDb() as never, { now, deleteMember })
    expect(deleteMember).not.toHaveBeenCalled()
    expect(r.heldAdultRoute).toEqual(['event-student', 'invited', 'event-form'])

    state.pending = [row('unsure', '2026-12-01T00:00:00Z')]
    state.failing.add('members')
    const r2 = await purgeUnconsentedAccounts(fakeDb() as never, { now, deleteMember })
    expect(deleteMember).not.toHaveBeenCalled()
    expect(r2.heldAdultRoute).toEqual(['unsure'])
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

  // Review finding: held and failing rows stayed first in a 25-row batch
  // ordered by purge_after, so once 25 existed nothing newer was ever purged.
  it('held and failing rows cannot starve newer ones: they wait for a later run', async () => {
    const held = Array.from({ length: PURGE_BATCH }, (_, i) => {
      state.inFlight.set(`held-${i}`, { guardianSigned: true })
      return row(`held-${i}`, `2026-11-${String(10 + (i % 15)).padStart(2, '0')}T00:00:00Z`)
    })
    state.pending = [...held, row('fail', '2026-11-05T00:00:00Z'), row('newer', '2026-12-05T00:00:00Z')]
    const deleted: string[] = []
    const deleteMember = async (id: string) => {
      if (id === 'fail') throw new Error('blocked')
      deleted.push(id)
    }
    const first = await purgeUnconsentedAccounts(fakeDb() as never, { now, deleteMember })
    expect(first.scanned).toBe(PURGE_BATCH)
    expect(first.errors.map((e) => e.memberId)).toEqual(['fail'])
    expect(deleted).toEqual([])

    // The next run: the rows already tried wait, so the rest are reached.
    const second = await purgeUnconsentedAccounts(fakeDb() as never, { now: new Date(now.getTime() + 60_000), deleteMember })
    expect(deleted).toEqual(['newer'])
    expect(second.errors).toEqual([])

    // A day later every held row is due again, behind nothing new.
    const third = await purgeUnconsentedAccounts(fakeDb() as never, { now: new Date(now.getTime() + 86_400_000), deleteMember })
    expect(third.scanned).toBe(PURGE_BATCH)
  })

  it('uses the archive-free registry entity that runs as a member, Clerk login included, blocked by event participation', async () => {
    const { getEntityDef } = await import('@/lib/deletion/registry')
    const def = getEntityDef('pending_consent_member')
    expect(def).toMatchObject({ table: 'members', actsAs: 'member', archive: false, softDelete: null })
    expect(def?.external).toEqual(expect.arrayContaining(['clerk', 'docusign', 'stripe']))
    expect(def?.dependents).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'participants', fkColumn: 'member_id' }),
    ]))
  })
})
