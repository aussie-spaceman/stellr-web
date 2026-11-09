import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CronRun } from '@/lib/cron-runs'
import { STELLR_TENANT_ID as STELLR } from '@/lib/tenancy/constants'
import { fakeChainDb, runnerAnswer, type ChainCall } from '@/test/helpers/fake-chain-db'
import {
  applySurveyRetention,
  applySurveyRetentionPerTenant,
  isDue,
  memberDueAt,
  noAccountDueAt,
  planSurveyRetention,
  redactedDue,
  retentionFailureLabel,
  retentionTenantOf,
  type RetentionPlan,
  type RetentionSubject,
  type SubjectKind,
} from './retention'

const TENANT_B = 'bbbbbbbb-0000-4000-8000-00000000000b'

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

  it('files rows with no tenant under Stellr, and keeps the tenants out of the printable list', async () => {
    const plan = await planSurveyRetention(db, new Date('2034-06-01T00:00:00Z'))
    expect(plan.tenantsOf.get('member:m-gone')).toEqual([STELLR])
    expect(Object.keys(redactedDue(plan)[0]).sort()).toEqual(['dueAt', 'id', 'invitations', 'kind', 'responses'])
  })
})

describe('planSurveyRetention, tenants (S5 B13)', () => {
  it("takes an invitation's tenant from its distribution and a response's from its own row", async () => {
    const db = fakeDb({
      survey_distributions: [
        { id: 'dS', event_date: '2026-11-07', tenant_id: null },
        { id: 'dB', event_date: '2026-11-07', tenant_id: TENANT_B },
      ],
      survey_invitations: [
        inv('i-1', { distribution_id: 'dS', participant_id: 'p-both' }),
        inv('i-2', { distribution_id: 'dB', participant_id: 'p-both' }),
        inv('i-3', { distribution_id: 'dB', participant_id: 'p-b' }),
      ],
      survey_responses: [resp('r-1', { participant_id: 'p-resp', tenant_id: TENANT_B })],
      participants: [],
      members: [],
    })
    const plan = await planSurveyRetention(db, new Date('2099-01-01T00:00:00Z'))
    expect(plan.tenantsOf.get('participant:p-both')).toEqual([STELLR, TENANT_B].sort())
    expect(plan.tenantsOf.get('participant:p-b')).toEqual([TENANT_B])
    expect(plan.tenantsOf.get('participant:p-resp')).toEqual([TENANT_B])
    expect(retentionTenantOf(plan, { kind: 'participant', id: 'p-b' })).toBe(TENANT_B)
    // A person whose rows span tenants is one purge, done in Stellr's slot.
    expect(retentionTenantOf(plan, { kind: 'participant', id: 'p-both' })).toBe(STELLR)
  })
})

describe('applySurveyRetentionPerTenant (S5 B13)', () => {
  const subject = (kind: SubjectKind, id: string): RetentionSubject => ({ kind, id, dueAt: '2033-01-01T00:00:00.000Z', invitations: 1, responses: 0 })
  const planOf = (due: RetentionSubject[], tenants: Record<string, string[]>): RetentionPlan => ({
    asOf: '2099-01-01T00:00:00.000Z',
    due,
    waiting: { member: 0, participant: 0, email: 0, nextDueAt: null },
    inactiveWithoutDate: 0,
    emailsHeld: 0,
    totals: { subjects: due.length, invitations: due.length, responses: 0 },
    tenantsOf: new Map(Object.entries(tenants)),
  })
  const tenantRows = [
    { id: STELLR, status: 'active', time_zone: 'America/Denver', is_platform_owner: true },
    { id: TENANT_B, status: 'suspended', time_zone: 'UTC', is_platform_owner: false },
  ]
  function setup(failFor: string[] = []) {
    return fakeChainDb(
      (call: ChainCall) => runnerAnswer(call, tenantRows) ?? { data: null, error: null },
      (_fn, args) => {
        const target = [...((args.p_participant_ids as string[]) ?? []), ...((args.p_emails as string[]) ?? [])][0]
        return failFor.includes(target) ? { data: null, error: { message: 'purge refused' } } : { data: { responses: 0, invitations: 1 }, error: null }
      },
    )
  }
  function fakeRun() {
    const fails: { where: string; message: string }[] = []
    const run: CronRun = { id: 'parent-1', fail: (where, err) => fails.push({ where, message: err instanceof Error ? err.message : String(err) }), finish: async () => {} }
    return { run, fails }
  }
  const purged = (rpcCalls: { args: unknown }[]) =>
    rpcCalls.map((c) => {
      const a = c.args as { p_participant_ids: string[]; p_emails: string[] }
      return a.p_participant_ids[0] ?? a.p_emails[0]
    })

  it('when only Stellr has subjects due: same deletions, order and failure labels as before, and no ledger', async () => {
    const { db, calls, rpcCalls } = setup(['p-2', 'x@example.org'])
    const plan = planOf([subject('participant', 'p-1'), subject('participant', 'p-2'), subject('email', 'x@example.org')], {
      'participant:p-1': [STELLR],
      'participant:p-2': [STELLR],
      'email:x@example.org': [STELLR],
    })
    const { run, fails } = fakeRun()

    const out = await applySurveyRetentionPerTenant(db, run, plan, 'system:test', { deadline: Date.now() + 45_000 })

    expect(purged(rpcCalls)).toEqual(['p-1', 'p-2', 'x@example.org'])
    const before = await applySurveyRetention(setup(['p-2', 'x@example.org']).db, plan, 'system:test')
    expect(out.result).toEqual(before)
    expect(fails).toEqual(before.failures.map((f) => ({ where: retentionFailureLabel(f), message: f.error })))
    expect(fails.map((f) => f.where)).toEqual(['participant:p-2', 'email:email'])
    expect(out.ledger).toEqual({})
    expect(out.notApplied).toBe(0)
    expect(calls.filter((c) => c.table === 'cron_runs')).toEqual([])
  })

  it("reaches a suspended tenant's subjects, and one tenant's failure does not stop the other", async () => {
    const { db, rpcCalls } = setup(['p-b1'])
    const plan = planOf([subject('participant', 'p-b1'), subject('participant', 'p-s'), subject('participant', 'p-b2')], {
      'participant:p-b1': [TENANT_B],
      'participant:p-s': [STELLR],
      'participant:p-b2': [TENANT_B],
    })
    const { run, fails } = fakeRun()

    const out = await applySurveyRetentionPerTenant(db, run, plan, 'system:test', { deadline: Date.now() + 45_000 })

    expect(purged(rpcCalls)).toEqual(['p-s', 'p-b1', 'p-b2'])
    expect(out.result.purged).toBe(2)
    expect(fails).toEqual([{ where: `t:${TENANT_B}:participant:p-b1`, message: 'purge refused' }])
    expect((out.ledger.skipped as string[])).toEqual([])
    expect((out.ledger.tenants as Record<string, Record<string, unknown>>)[TENANT_B]).toMatchObject({ purged: 1, failed: 1, ok: false })
  })

  it('leaves subjects for the next run once the time has run out', async () => {
    const { db, rpcCalls } = setup()
    const plan = planOf([subject('participant', 'p-1')], { 'participant:p-1': [STELLR] })
    const { run, fails } = fakeRun()
    const out = await applySurveyRetentionPerTenant(db, run, plan, 'system:test', { deadline: Date.now() - 1 })
    expect(rpcCalls).toEqual([])
    expect(out.notApplied).toBe(1)
    // A Stellr-only run whose time ran out is not ok: the wait shows in cron_runs.
    expect(fails).toEqual([{ where: 'not_applied', message: '1 due subject(s) left for the next run: time ran out' }])
  })

  it('records no not_applied failure when every due subject was reached', async () => {
    const { db } = setup()
    const plan = planOf([subject('participant', 'p-1')], { 'participant:p-1': [STELLR] })
    const { run, fails } = fakeRun()
    await applySurveyRetentionPerTenant(db, run, plan, 'system:test', { deadline: Date.now() + 45_000 })
    expect(fails).toEqual([])
  })

  it("purges a subject whose rows span tenants in Stellr's slot, even when the other tenant cannot run", async () => {
    // TENANT_A sorts before Stellr's id and TENANT_C after it, so the slot cannot
    // come from the sort order. Neither is in the tenants table, so neither runs.
    const TENANT_A = '00000000-0000-4000-8000-000000000000'
    const TENANT_C = 'cccccccc-0000-4000-8000-00000000000c'
    const { db, rpcCalls } = setup()
    const plan = planOf(
      [subject('participant', 'p-ac'), subject('participant', 'p-a'), subject('participant', 'p-sc')],
      {
        'participant:p-ac': [TENANT_A, TENANT_C],
        'participant:p-a': [TENANT_A],
        'participant:p-sc': [STELLR, TENANT_C],
      },
    )
    expect(retentionTenantOf(plan, { kind: 'participant', id: 'p-ac' })).toBe(STELLR)
    expect(retentionTenantOf(plan, { kind: 'participant', id: 'p-sc' })).toBe(STELLR)
    const { run, fails } = fakeRun()

    const out = await applySurveyRetentionPerTenant(db, run, plan, 'system:test', { deadline: Date.now() + 45_000 })

    expect(purged(rpcCalls)).toEqual(['p-ac', 'p-sc'])
    expect(out.result.purged).toBe(2)
    expect(fails).toEqual([{ where: `t:${TENANT_A}:run`, message: 'tenant not found or tenants unreadable' }])
  })
})
