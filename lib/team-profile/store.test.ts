import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CronRun } from '@/lib/cron-runs'
import { STELLR_TENANT_ID as STELLR } from '@/lib/tenancy/constants'
import { fakeChainDb, runnerAnswer, type ChainCall, type Row } from '@/test/helpers/fake-chain-db'

// The team-profiles daily sweep per tenant (S5 B13), against a stand-in
// database. Email, the CMS and rendering are mocked; the selection, the sends
// and what the run records are real.

const TENANT_B = 'bbbbbbbb-0000-4000-8000-00000000000b'

const sendEmail = vi.fn()
vi.mock('@/lib/email', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }))
const event = (slug: string) => ({ slug, title: slug, date: '2099-05-01', endDate: null, lastDay: '2099-05-01', timeZone: 'UTC', state: null, cancelled: false, isCampaign: false })
vi.mock('@/lib/survey/events', () => ({
  loadAllSurveyEvents: async () => [event('a-event'), event('b-event')],
  loadSurveyEvent: async (slug: string) => event(slug),
}))
vi.mock('@/lib/event-emails/send', () => ({ loadEventForEmail: async (slug: string) => ({ slug }) }))
vi.mock('@/lib/event-emails/render', () => ({
  EVENT_EMAIL_FROM: 'from@example.test',
  EVENT_EMAIL_REPLY_TO: 'reply@example.test',
  eventMergeVars: () => ({}),
  recipientMergeVars: () => ({}),
  renderEventEmail: () => ({ subject: 's', html: 'h', text: 't' }),
}))

const { dispatchTeamProfiles } = await import('./store')

function student(id: string, slug: string, tenant: string | null): Row {
  return {
    id,
    member_id: null,
    first_name: id,
    last_name: 'Example',
    email: `${id}@example.test`,
    date_of_birth: '2000-01-01', // an adult with no agreement: forms complete
    event_role: 'participant',
    emergency_contact_email: null,
    emergency_contact_first_name: null,
    registrations: { event_slug: slug, status: 'confirmed', tenant_id: tenant },
  }
}

const TENANTS = [
  { id: STELLR, status: 'active', time_zone: 'America/Denver', is_platform_owner: true },
  { id: TENANT_B, status: 'active', time_zone: 'UTC', is_platform_owner: false },
]

function setup(people: Row[], opts: { failInsertFor?: string } = {}) {
  return fakeChainDb(answerFor(people, opts))
}

function answerFor(people: Row[], opts: { failInsertFor?: string } = {}) {
  return (call: ChainCall) => {
    const runner = runnerAnswer(call, TENANTS)
    if (runner) return runner
    if (call.table === 'participants') {
      // Without tenant_id in the select, the embedded registration has no such key.
      const withTenant = call.columns.includes('tenant_id')
      const rows = people.map((p) => {
        if (withTenant) return p
        const { tenant_id: _t, ...reg } = p.registrations as Row
        return { ...p, registrations: reg }
      })
      return { data: rows, error: null }
    }
    if (call.table === 'team_profiles' && call.op === 'insert') {
      const payload = call.payload as Row
      if (payload.participant_id === opts.failInsertFor) return { data: null, error: { message: 'insert refused', code: 'XX000' } }
      return { data: { id: payload.id, token_version: 1, prefilled_from: null, submitted_at: null }, error: null }
    }
    if (call.table === 'team_profiles' && call.op === 'select' && !call.single) return { data: [], error: null }
    if (call.table === 'agreements') return { data: [], error: null }
    return { data: null, error: null }
  }
}

function fakeRun() {
  const fails: { where: string; message: string }[] = []
  const run: CronRun = {
    id: 'parent-1',
    fail: (where, err) => fails.push({ where, message: err instanceof Error ? err.message : String(err) }),
    finish: async () => {},
  }
  return { run, fails }
}

const recipients = () => sendEmail.mock.calls.map((c) => (c[0] as Row).to)

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubEnv('SURVEY_TOKEN_SECRET', 'test-only-token-secret-not-used-anywhere-else')
  sendEmail.mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('the daily sweep when only Stellr has students', () => {
  it('sends to the same students and returns the same counts, with no ledger or child row', async () => {
    const { db, calls } = setup([student('s1', 'a-event', null), student('s2', 'a-event', STELLR)])
    const { run, fails } = fakeRun()

    const result = await dispatchTeamProfiles(db, { budgetMs: 45_000, run })

    expect(result).toEqual({ sent: 2, failed: 0, waiting: 0, deferred: 0 })
    expect(recipients()).toEqual(['s1@example.test', 's2@example.test'])
    expect(fails).toEqual([])
    expect(calls.filter((c) => c.table === 'cron_runs')).toEqual([])
  })

  it('still ends the run on a failed write, so the route records run alone and no counts', async () => {
    const { db } = setup([student('s1', 'a-event', null)], { failInsertFor: 's1' })
    const { run, fails } = fakeRun()
    await expect(dispatchTeamProfiles(db, { budgetMs: 45_000, run })).rejects.toThrow('Creating team profile failed: insert refused')
    expect(fails).toEqual([])
  })
})

describe('the daily sweep with two tenants', () => {
  it("keeps sending Stellr's team profiles when the other tenant's write fails", async () => {
    const { db, calls } = setup([student('b1', 'b-event', TENANT_B), student('s1', 'a-event', null)], { failInsertFor: 'b1' })
    const { run, fails } = fakeRun()

    const result = await dispatchTeamProfiles(db, { budgetMs: 45_000, run })

    expect(recipients()).toEqual(['s1@example.test'])
    expect(result).toMatchObject({ sent: 1, failed: 0, waiting: 0, deferred: 0 })
    expect(fails).toEqual([{ where: `t:${TENANT_B}:run`, message: 'Creating team profile failed: insert refused' }])
    const tenants = (result as unknown as { tenants: Record<string, Row> }).tenants
    expect(tenants[STELLR]).toMatchObject({ sent: 1, ok: true })
    expect(tenants[TENANT_B]).toMatchObject({ ok: false })
    const children = calls.filter((c) => c.table === 'cron_runs' && c.op === 'insert').map((c) => (c.payload as Row).tenant_id)
    expect(children).toEqual([STELLR, TENANT_B])
  })

  it('stops a tenant that overran its slice from sending to its next student', async () => {
    const { db } = setup([student('s1', 'a-event', null), student('s2', 'a-event', null), student('b1', 'b-event', TENANT_B)])
    sendEmail.mockImplementation(async (msg: Row) => {
      if (msg.to === 's1@example.test') await new Promise((r) => setTimeout(r, 1_000))
    })
    const { run, fails } = fakeRun()
    // No deadline check can fire while the clock stands still: only the abort signal can.
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 8, 12))

    // Stellr's slice is half of 1.4 s, plus 10 ms; s1 takes 1 s. Tenant B's slice
    // leaves room for the 550 ms spacing between sends.
    const result = await dispatchTeamProfiles(db, { budgetMs: 1_400, run, slice: { floorMs: 10, overrunMs: 10 } })
    await new Promise((r) => setTimeout(r, 1_200))

    expect(recipients()).toEqual(['s1@example.test', 'b1@example.test'])
    expect(fails.map((f) => f.where)).toEqual([`t:${STELLR}:slice`])
    expect((result as unknown as { tenants: Record<string, Row> }).tenants[STELLR]).toMatchObject({ ok: false })
  }, 15_000)
})

describe('pre-filling from an earlier profile', () => {
  // One member: a submitted profile with Stellr, and one with tenant B.
  const earlier = [
    { id: 'prev-stellr', tenant_id: STELLR, answers: {} },
    { id: 'prev-b', tenant_id: TENANT_B, answers: {} },
  ]
  /** Answers the previous-profile read by its tenant filter, as PostgREST would. */
  function prefillDb(people: Row[]) {
    const inner = answerFor(people)
    return fakeChainDb((call: ChainCall) => {
      if (call.table === 'team_profiles' && call.op === 'select' && call.columns === 'id, answers') {
        const or = call.filters.find((f) => f.method === 'or')
        const eq = call.filters.find((f) => f.method === 'eq' && f.args[0] === 'tenant_id')
        const tenant = or ? STELLR : eq ? eq.args[1] : null
        const match = tenant ? earlier.find((r) => r.tenant_id === tenant) : earlier[earlier.length - 1]
        return { data: match ?? null, error: null }
      }
      return inner(call)
    })
  }
  const prefilledFrom = (calls: ChainCall[]) =>
    Object.fromEntries(
      calls
        .filter((c) => c.table === 'team_profiles' && c.op === 'insert')
        .map((c) => [(c.payload as Row).participant_id, (c.payload as Row).prefilled_from]),
    )
  const memberStudent = (id: string, slug: string, tenant: string | null) => ({ ...student(id, slug, tenant), member_id: 'm-1' })

  it("fills each tenant's new row only from that tenant's earlier profile", async () => {
    const { db, calls } = prefillDb([memberStudent('b1', 'b-event', TENANT_B), memberStudent('s1', 'a-event', null)])
    const { run } = fakeRun()
    await dispatchTeamProfiles(db, { budgetMs: 45_000, run })
    expect(prefilledFrom(calls)).toEqual({ s1: 'prev-stellr', b1: 'prev-b' })
  })

  it("fills a scoped call's row only from Stellr's profiles, the only events that take profiles", async () => {
    const { db, calls } = prefillDb([memberStudent('s1', 'a-event', STELLR)])
    await dispatchTeamProfiles(db, { participantIds: ['s1'] })
    expect(prefilledFrom(calls)).toEqual({ s1: 'prev-stellr' })
  })
})

describe('scoped calls (an agreement completing, one event)', () => {
  it('keep the plain path: no tenant column, no runner, whether or not a run is passed', async () => {
    const { db, calls } = setup([student('s1', 'a-event', TENANT_B)])
    const { run } = fakeRun()
    const result = await dispatchTeamProfiles(db, { participantIds: ['s1'], run })
    expect(result).toEqual({ sent: 1, failed: 0, waiting: 0, deferred: 0 })
    expect(calls.find((c) => c.table === 'participants')?.columns).not.toContain('tenant_id')
    expect(calls.some((c) => c.table === 'tenants' || c.table === 'cron_runs')).toBe(false)
  })
})
