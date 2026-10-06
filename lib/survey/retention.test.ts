import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isDue, memberDueAt, noAccountDueAt, planSurveyRetention, redactedDue } from './retention'

describe('retention rule (7 years)', () => {
  it('runs from deactivation only while the account stays inactive', () => {
    expect(memberDueAt({ isActive: false, deletedAt: '2026-03-15T10:00:00Z' })?.toISOString()).toBe('2033-03-15T10:00:00.000Z')
    expect(memberDueAt({ isActive: true, deletedAt: '2026-03-15T10:00:00Z' })).toBeNull()
    expect(memberDueAt({ isActive: false, deletedAt: null })).toBeNull()
    expect(memberDueAt({ isActive: null, deletedAt: '2026-03-15T10:00:00Z' })).toBeNull()
  })

  it('no account: 7 years after the end of the latest event year', () => {
    expect(noAccountDueAt([2026])?.toISOString()).toBe('2034-01-01T00:00:00.000Z')
    expect(noAccountDueAt([2026, 2028, null])?.toISOString()).toBe('2036-01-01T00:00:00.000Z')
    expect(noAccountDueAt([])).toBeNull()
  })

  it('is due on the day, not before', () => {
    const at = new Date('2034-01-01T00:00:00Z')
    expect(isDue(at, new Date('2033-12-31T23:59:59Z'))).toBe(false)
    expect(isDue(at, at)).toBe(true)
    expect(isDue(null, new Date('2099-01-01'))).toBe(false)
  })
})

// A read-only stand-in for the few query shapes the planner uses.
type Row = Record<string, unknown>
function fakeDb(tables: Record<string, Row[]>): SupabaseClient {
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])]
    const q = {
      select: () => q,
      order: () => q,
      eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), q),
      in: (c: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[c]))), q),
      range: (a: number, b: number) => ((rows = rows.slice(a, b + 1)), q),
      then: (ok: (v: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok),
    }
    return q
  }
  return { from } as unknown as SupabaseClient
}

const inv = (id: string, over: Row) => ({ id, distribution_id: 'd26', member_id: null, participant_id: null, email: `${id}@example.org`, send_via: 'self', ...over })
const resp = (id: string, over: Row) => ({ id, invitation_id: null, member_id: null, participant_id: null, event_year: 2026, source: 'app', ...over })

describe('planSurveyRetention', () => {
  const db = fakeDb({
    survey_distributions: [
      { id: 'd26', event_date: '2026-11-07' },
      { id: 'd30', event_date: '2030-04-01' },
    ],
    survey_invitations: [
      inv('i-gone', { member_id: 'm-gone' }), // deactivated 2026
      inv('i-active', { member_id: 'm-active' }),
      inv('i-noclock', { member_id: 'm-noclock' }),
      inv('i-linked', { participant_id: 'p-linked' }), // participant later linked to m-active
      inv('i-part', { participant_id: 'p-solo', send_via: 'guardian', email: 'parent@example.org' }),
      inv('i-teacher', { email: 'Teacher@School.org' }), // email-only, 2026
      inv('i-teacher30', { distribution_id: 'd30', email: 'teacher@school.org' }), // same address, 2030
      inv('i-shared', { email: 'shared@example.org' }),
      inv('i-shared-m', { member_id: 'm-active', email: 'shared@example.org' }),
      inv('i-hasacct', { email: 'member@example.org' }),
    ],
    survey_responses: [
      resp('r-gone', { invitation_id: 'i-gone', member_id: 'm-gone' }),
      resp('r-part', { invitation_id: 'i-part', participant_id: 'p-solo' }),
      resp('r-legacy', { source: 'legacy_import' }),
    ],
    participants: [
      { id: 'p-linked', member_id: 'm-active' },
      { id: 'p-solo', member_id: null },
    ],
    members: [
      { id: 'm-gone', is_active: false, deleted_at: '2026-01-10T00:00:00Z', email: 'gone@example.org' },
      { id: 'm-active', is_active: true, deleted_at: null, email: 'active@example.org' },
      { id: 'm-noclock', is_active: false, deleted_at: null, email: 'noclock@example.org' },
      { id: 'm-other', is_active: true, deleted_at: null, email: 'member@example.org' },
    ],
  })

  it('reports nothing due today', async () => {
    const plan = await planSurveyRetention(db, new Date('2026-10-02T00:00:00Z'))
    expect(plan.due).toEqual([])
    expect(plan.waiting.member).toBe(1)
    expect(plan.waiting.nextDueAt).toBe('2033-01-10T00:00:00.000Z')
    expect(plan.inactiveWithoutDate).toBe(1)
  })

  it('in 2034 picks the deactivated member, the participant and the 2026-only addresses', async () => {
    const plan = await planSurveyRetention(db, new Date('2034-06-01T00:00:00Z'))
    const due = plan.due.map((s) => `${s.kind}:${s.id}`).sort()
    expect(due).toEqual(['member:m-gone', 'participant:p-solo'])
    // teacher@ was surveyed again in 2030, so it waits until 2038; shared@ also
    // reached an active member's invitation; member@ is a member's address.
    expect(plan.waiting.email).toBe(1)
    expect(plan.emailsHeld).toBe(2)
    expect(plan.totals).toEqual({ subjects: 2, invitations: 2, responses: 2 })
  })

  it('never selects active members or members without a deactivation date', async () => {
    const plan = await planSurveyRetention(db, new Date('2099-01-01T00:00:00Z'))
    const ids = plan.due.map((s) => s.id)
    expect(ids).not.toContain('m-active')
    expect(ids).not.toContain('m-noclock')
    expect(ids).toContain('teacher@school.org')
  })

  it('masks email subjects in printable output', async () => {
    const plan = await planSurveyRetention(db, new Date('2099-01-01T00:00:00Z'))
    expect(redactedDue(plan).find((s) => s.kind === 'email')?.id).toBe('t***@school.org')
  })
})
