// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CRON_SCOPES } from '@/lib/cron-scope'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { fakeChainDb, runnerAnswer, type ChainCall, type Row } from '@/test/helpers/fake-chain-db'

// S5 B14: event-emails and docusign-reminders run per tenant. A run that only
// touches Stellr selects the same rows, sends the same mail and writes the same
// cron_runs result as before. Another tenant's event mail goes out only with
// TENANT_EVENT_MAIL_ENABLED, from its own sender, inside its own slice; one
// tenant failing does not stop the next. Another tenant's Stellr-signing
// envelopes are chased only with the flag on, from its own sender; its DocuSign
// envelopes are always held.

const h = vi.hoisted(() => ({
  db: null as unknown,
  finished: [] as Row[],
  fails: [] as string[],
  sendEventEmail: vi.fn(),
  reclaimStuckSending: vi.fn(),
  runCatchUps: vi.fn(),
  remind: vi.fn(),
  sendEmail: vi.fn(),
  clock: null as null | { now: number },
}))
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: () => {},
}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => h.db }))
vi.mock('@/lib/cron', () => ({ guardCron: () => null }))
vi.mock('@/lib/cron-runs', () => ({
  startCronRun: async () => ({
    id: 'parent-1',
    fail: (where: string) => h.fails.push(where),
    finish: async (result: Row) => {
      h.finished.push(result)
    },
  }),
  startTenantRun: async () => ({ id: 'child', fail: () => {}, finish: async () => {} }),
}))
vi.mock('@/lib/events/repo', () => ({ getEventBySlug: async () => ({ date: '2099-01-01' }) }))
vi.mock('@/lib/event-emails/send', () => ({ sendEventEmail: h.sendEventEmail, reclaimStuckSending: h.reclaimStuckSending }))
vi.mock('@/lib/event-emails/catch-up', () => ({ runCatchUps: h.runCatchUps }))
vi.mock('@/lib/esign/outbox', () => ({ drainOutbox: vi.fn(async () => ({ sent: 0, waiting: 0, deferred: 0, failed: 0 })) }))
vi.mock('@/lib/esign/heartbeat', () => ({ checkHeartbeat: vi.fn(async () => ({ quiet: [] })) }))
vi.mock('@/lib/esign/operations', () => ({ remindEnvelopeRow: h.remind }))
vi.mock('@/lib/docusign-agreements', () => ({ AGREEMENT_LABEL: { minor: 'Parental Consent Form' } }))
vi.mock('@/lib/docusign-recipients', () => ({
  syncEnvelopeRecipients: async () => [{ name: 'Parent', email: 'p@example.com', roleName: 'Guardian', status: 'sent', deliveredAt: null }],
}))
vi.mock('@/lib/email', () => ({
  sendEmail: h.sendEmail,
  docusignReminderToMinorEmail: () => ({ subject: 's', html: 'h', text: 't' }),
  docusignReminderToSignerEmail: () => ({ subject: 's', html: 'h', text: 't' }),
  docusignSentToGuardianEmail: () => ({ subject: 's', html: 'h', text: 't' }),
}))

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const NO_SENDER = '33333333-3333-4333-8333-333333333333'
const TENANTS: Row[] = [
  { id: STELLR_TENANT_ID, status: 'active', time_zone: 'America/Denver', is_platform_owner: true, display_name: 'Stellr Education', branding: {} },
  { id: A, status: 'active', time_zone: 'Australia/Sydney', is_platform_owner: false, display_name: 'Rocket Club', branding: { reply_to: 'events@rocket.example.org' } },
  { id: B, status: 'active', time_zone: 'America/New_York', is_platform_owner: false, display_name: 'Orbit League', branding: { reply_to: 'hello@orbit.example.org' } },
  { id: NO_SENDER, status: 'active', time_zone: 'America/Chicago', is_platform_owner: false, display_name: 'Quiet Org', branding: {} },
]
const fromOf = (id: string) => `"${TENANTS.find((t) => t.id === id)!.display_name} via Stellr" <no-reply@mail.stellreducation.org>`

type Scheduled = { id: string; event_slug: string; schedule_days_before: number; tenant_id: string | null }
const due = (id: string, tenant: string | null, daysBefore = 100_000): Scheduled => ({ id, event_slug: `ev-${id}`, schedule_days_before: daysBefore, tenant_id: tenant })

function eventEmailsDb(scheduled: Scheduled[], followUps: Row[] = []) {
  return fakeChainDb((call: ChainCall) => {
    const runner = call.table === 'tenants' && call.single ? null : runnerAnswer(call, TENANTS)
    if (runner) return runner
    if (call.table === 'tenants') {
      const id = call.filters.find((f) => f.method === 'eq')?.args[1]
      return { data: TENANTS.find((t) => t.id === id) ?? null, error: null }
    }
    if (call.table === 'event_emails' && call.op === 'select') {
      return call.columns.includes('schedule_days_before') ? { data: scheduled, error: null } : { data: followUps, error: null }
    }
    return { data: null, error: null }
  })
}

const STELLR_RESULT_KEYS = ['catchUpDeferred', 'catchUpEmailed', 'deferred', 'due', 'resumed', 'sent', 'signingEmailsSent', 'signingEmailsWaiting', 'skipped']

async function runEventEmails(flag: boolean) {
  vi.resetModules()
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
  vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', flag ? 'true' : '')
  const { GET } = await import('@/app/api/cron/event-emails/route')
  const res = await GET(new Request('https://example.test/api/cron/event-emails') as never)
  return { status: res.status, body: (await res.json()) as Row, finished: h.finished[0] }
}

beforeEach(() => {
  h.finished = []
  h.fails = []
  h.clock = null
  h.sendEventEmail.mockReset().mockImplementation(async () => ({ ok: true }))
  h.reclaimStuckSending.mockReset().mockImplementation(async () => ({ reclaimed: 0, errors: [] }))
  h.runCatchUps.mockReset().mockImplementation(async () => ({ checked: 0, emailed: 0, deferred: 0, errors: [] }))
  h.remind.mockReset().mockImplementation(async () => 1)
  h.sendEmail.mockReset().mockImplementation(async () => ({ id: 'm' }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('event-emails, Stellr alone', () => {
  it.each([[false], [true]])('flag %s: same sends, same arguments, same result keys, no ledger', async (flag) => {
    const fake = eventEmailsDb([due('s1', null), due('s2', STELLR_TENANT_ID)])
    h.db = fake.db
    const { status, body, finished } = await runEventEmails(flag)
    expect(status).toBe(200)
    expect(h.sendEventEmail.mock.calls.map((c) => c.slice(1))).toEqual([
      ['s1', { trigger: 'schedule', triggeredBy: 'schedule' }],
      ['s2', { trigger: 'schedule', triggeredBy: 'schedule' }],
    ])
    expect(Object.keys(body).sort()).toEqual(STELLR_RESULT_KEYS)
    expect(Object.keys(finished).sort()).toEqual(STELLR_RESULT_KEYS)
    expect(finished).toMatchObject({ due: 2, sent: 2 })
    expect(h.fails).toEqual([])
    // Stellr's follow-ups keep Stellr's rows, with Stellr's own sender (none passed).
    expect(h.reclaimStuckSending.mock.calls[0][2]).toEqual({ tenantId: STELLR_TENANT_ID })
    expect(h.runCatchUps.mock.calls[0][4]).toEqual({ tenantId: STELLR_TENANT_ID })
    // The scheduled read is the same rows plus the tenant column; no child ledger rows.
    expect(fake.calls.filter((c) => c.table === 'cron_runs')).toEqual([])
    const scheduled = fake.calls.find((c) => c.table === 'event_emails')!
    expect(scheduled.filters.map((f) => f.method)).toEqual(['eq', 'not', 'order'])
  })

  it('flag off: makes no extra read of other tenants’ follow-ups', async () => {
    const fake = eventEmailsDb([due('s1', null)])
    h.db = fake.db
    await runEventEmails(false)
    expect(fake.calls.filter((c) => c.table === 'event_emails' && c.columns === 'tenant_id')).toEqual([])
  })

  it('a Stellr send that throws still ends the run as before: the route throws (a 500) and writes no run.finish', async () => {
    h.db = eventEmailsDb([due('s1', null)]).db
    h.sendEventEmail.mockRejectedValueOnce(new Error('database gone'))
    await expect(runEventEmails(false)).rejects.toThrow('database gone')
    expect(h.finished).toEqual([])
  })

  it('a Stellr send carries no tenant sender and no slice signal', async () => {
    h.db = eventEmailsDb([due('s1', null)]).db
    await runEventEmails(true)
    expect(h.sendEventEmail.mock.calls[0][2]).not.toHaveProperty('signal')
    expect(h.reclaimStuckSending.mock.calls[0][2]).not.toHaveProperty('signal')
    expect(h.runCatchUps.mock.calls[0][4]).not.toHaveProperty('signal')
  })

  it('records a failed Stellr send under the same label as before', async () => {
    h.db = eventEmailsDb([due('s1', null)]).db
    h.sendEventEmail.mockResolvedValueOnce({ ok: false, status: 500, error: 'boom' })
    await runEventEmails(false)
    expect(h.fails).toEqual(['s1'])
  })
})

describe('event-emails with another tenant’s rows', () => {
  it('flag off, the default: holds the tenant’s rows, sends Stellr’s, and says how many were held', async () => {
    h.db = eventEmailsDb([due('s1', null), due('a1', A)]).db
    const { finished } = await runEventEmails(false)
    expect(h.sendEventEmail.mock.calls.map((c) => c[1])).toEqual(['s1'])
    expect(finished).toMatchObject({ sent: 1, tenantHeld: 1 })
    expect(finished.tenants).toBeUndefined()
    expect(h.fails).toEqual([])
  })

  it('flag on: each tenant sends from its own sender, Stellr from its own, with a per-tenant ledger', async () => {
    h.db = eventEmailsDb([due('s1', null), due('a1', A), due('b1', B)]).db
    const { finished } = await runEventEmails(true)
    const calls = h.sendEventEmail.mock.calls.map((c) => [c[1], (c[2] as { sender?: { from: string } }).sender?.from ?? null])
    expect(calls).toEqual([['s1', null], ['a1', fromOf(A)], ['b1', fromOf(B)]])
    expect(finished).toMatchObject({ sent: 3 })
    expect(Object.keys(finished.tenants as Row).sort()).toEqual([STELLR_TENANT_ID, A, B].sort())
    expect(finished.tenantHeld).toBeUndefined()
    // Each tenant's follow-ups are its own, with its sender.
    expect(h.reclaimStuckSending.mock.calls.map((c) => (c[2] as { tenantId: string }).tenantId)).toEqual([STELLR_TENANT_ID, A, B])
    expect((h.runCatchUps.mock.calls[1][4] as { sender: { replyTo: string } }).sender.replyTo).toBe('events@rocket.example.org')
    // A tenant's sends carry its slice signal, so they stop when the runner moves on.
    for (const call of [h.sendEventEmail.mock.calls[1][2], h.reclaimStuckSending.mock.calls[1][2], h.runCatchUps.mock.calls[1][4]]) {
      expect((call as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal)
    }
  })

  it('flag on: a tenant event Sanity does not know sends nothing; its row waits', async () => {
    const fake = eventEmailsDb([due('s1', null), due('a1', A)])
    h.db = fake.db
    vi.doMock('@/lib/events/repo', () => ({ getEventBySlug: async (slug: string) => (slug === 'ev-a1' ? null : { date: '2099-01-01' }) }))
    const { finished } = await runEventEmails(true)
    // Back to the file's default, not to the real (Sanity-backed) module.
    vi.doMock('@/lib/events/repo', () => ({ getEventBySlug: async () => ({ date: '2099-01-01' }) }))
    expect(h.sendEventEmail.mock.calls.map((c) => c[1])).toEqual(['s1'])
    expect((finished.tenants as Record<string, Row>)[A]).toMatchObject({ due: 0, sent: 0, skipped: 0 })
    expect(fake.calls.filter((c) => c.table === 'event_emails' && c.op === 'update')).toEqual([])
  })

  it('flag on: a tenant that throws is recorded, and the next tenant still sends', async () => {
    h.db = eventEmailsDb([due('s1', null), due('a1', A), due('b1', B)]).db
    h.sendEventEmail.mockImplementation(async (_db: unknown, id: string) => {
      if (id === 'a1') throw new Error('tenant A broke')
      return { ok: true }
    })
    const { status, finished } = await runEventEmails(true)
    expect(status).toBe(200)
    expect(h.sendEventEmail.mock.calls.map((c) => c[1])).toEqual(['s1', 'a1', 'b1'])
    expect(h.fails).toEqual([`t:${A}:run`])
    expect(finished).toMatchObject({ sent: 2 })
    expect((finished.tenants as Record<string, Row>)[A]).toMatchObject({ ok: false })
    expect((finished.tenants as Record<string, Row>)[B]).toMatchObject({ ok: true, sent: 1 })
  })

  it('flag on: a tenant cannot spend the next tenant’s slice', async () => {
    // The clock stands still except while tenant A sends: its first send runs
    // past the end of its own slice, so its second waits for the next run and
    // tenant B still gets a turn and sends.
    let clock = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    h.db = eventEmailsDb([due('a1', A), due('a2', A), due('b1', B)]).db
    h.sendEventEmail.mockImplementation(async (_db: unknown, id: string) => {
      // Stellr, A and B share 15 s; A's slice is 7.5 s.
      if (id === 'a1') clock += 8_000
      return { ok: true }
    })
    const { finished } = await runEventEmails(true)
    expect(h.sendEventEmail.mock.calls.map((c) => c[1])).toEqual(['a1', 'b1'])
    expect((finished.tenants as Record<string, Row>)[A]).toMatchObject({ due: 2, sent: 1, deferred: 1 })
    expect((finished.tenants as Record<string, Row>)[B]).toMatchObject({ due: 1, sent: 1 })
  })

  it('flag on: a tenant with no usable sender sends nothing and is recorded', async () => {
    h.db = eventEmailsDb([due('q1', NO_SENDER)]).db
    const { finished } = await runEventEmails(true)
    expect(h.sendEventEmail).not.toHaveBeenCalled()
    expect(h.fails).toEqual([`t:${NO_SENDER}:sender`])
    expect((finished.tenants as Record<string, Row>)[NO_SENDER]).toMatchObject({ ok: false, sent: 0 })
  })

  it('flag on: a tenant with only follow-up work still gets its turn', async () => {
    h.db = eventEmailsDb([], [{ tenant_id: B }, { tenant_id: B }]).db
    await runEventEmails(true)
    expect(h.reclaimStuckSending.mock.calls.map((c) => (c[2] as { tenantId: string }).tenantId)).toEqual([STELLR_TENANT_ID, B])
  })

  it('flag on: a tenant’s “today” is its own time zone’s, Stellr’s stays Mountain', async () => {
    // 15:00 UTC on 28 Sept: still the 28th in Denver, already the 29th in Sydney.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-28T15:00:00Z'))
    // Event on 3 Oct, sent 4 days before: due from the 29th.
    const fake = eventEmailsDb([
      { id: 's1', event_slug: 'ev', schedule_days_before: 4, tenant_id: null },
      { id: 'a1', event_slug: 'ev', schedule_days_before: 4, tenant_id: A },
    ])
    h.db = fake.db
    vi.doMock('@/lib/events/repo', () => ({ getEventBySlug: async () => ({ date: '2026-10-03' }) }))
    await runEventEmails(true)
    vi.doUnmock('@/lib/events/repo')
    expect(h.sendEventEmail.mock.calls.map((c) => c[1])).toEqual(['a1'])
    expect(h.runCatchUps.mock.calls.map((c) => c[3])).toEqual(['2026-09-28', '2026-09-29'])
  })
})

// ── docusign-reminders ──────────────────────────────────────────────────────

const ENVELOPE = {
  envelope_type: 'minor', minor_name: 'Lily', signer_name: 'Parent', signer_email: 'p@example.com', event_title: 'CO SDC',
  member_id: null, status: 'sent', signers_total: 2, signers_completed: 1, reused_from: null, reminder_count: 0,
}
const env = (id: string, provider: 'docusign' | 'native', tenant: string | null) => ({ ...ENVELOPE, id, envelope_id: `env-${id}`, provider, tenant_id: tenant })

function remindersDb(envelopes: Row[]) {
  return fakeChainDb((call: ChainCall) => {
    // One tenant's sender read (loadTenantSender) is a single-row read by id.
    if (call.table === 'tenants' && call.single) {
      const id = call.filters.find((f) => f.method === 'eq')?.args[1]
      return { data: TENANTS.find((t) => t.id === id) ?? null, error: null }
    }
    const runner = runnerAnswer(call, TENANTS)
    if (runner) return runner
    if (call.table === 'agreements' && call.op === 'select') return { data: envelopes, error: null }
    if (call.table === 'agreements' && call.op === 'update') return { data: [{ id: 'claimed' }], error: null }
    return { data: [], error: null }
  })
}

async function runReminders(flag: boolean) {
  vi.resetModules()
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
  vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', flag ? 'true' : '')
  const { GET } = await import('@/app/api/cron/docusign-reminders/route')
  const res = await GET(new Request('https://example.test/api/cron/docusign-reminders') as never)
  return { status: res.status, body: (await res.json()) as Row, finished: h.finished[0] }
}

const REMINDER_RESULT_KEYS = ['deferred', 'eligible', 'outbox', 'processed', 'skippedBounced']
const reminded = () => h.remind.mock.calls.map((c) => (c[1] as { id: string }).id)

describe('docusign-reminders', () => {
  it.each([[false], [true]])('flag %s, Stellr alone: chases DocuSign and Stellr signing as before, same result keys', async (flag) => {
    h.db = remindersDb([env('d1', 'docusign', null), env('n1', 'native', STELLR_TENANT_ID)]).db
    const { finished } = await runReminders(flag)
    expect(reminded()).toEqual(['d1', 'n1'])
    // The DocuSign-era guardian email goes out for the DocuSign row only, as before.
    expect(h.sendEmail).toHaveBeenCalledTimes(1)
    expect(Object.keys(finished).sort()).toEqual(REMINDER_RESULT_KEYS)
    expect(finished).toMatchObject({ processed: 2, eligible: 2 })
    expect(h.fails).toEqual([])
  })

  it('flag off: holds every row of another tenant', async () => {
    h.db = remindersDb([env('d1', 'docusign', null), env('a1', 'native', A)]).db
    const { finished } = await runReminders(false)
    expect(reminded()).toEqual(['d1'])
    expect(finished).toMatchObject({ processed: 1, eligible: 2, tenantHeld: 1 })
  })

  it('flag on: chases another tenant’s Stellr-signing envelopes in its own slice, and still holds its DocuSign ones', async () => {
    // The signing reminder itself goes through lib/esign/outbox.ts with the
    // tenant's sender (lib/esign/tenant-sender.test.ts proves the From and
    // Reply-To); here the cron hands each tenant's native rows to the engine.
    const fake = remindersDb([env('s1', 'native', null), env('a-native', 'native', A), env('a-docusign', 'docusign', A), env('b1', 'native', B)])
    h.db = fake.db
    const { finished } = await runReminders(true)
    expect(reminded()).toEqual(['s1', 'a-native', 'b1'])
    // No DocuSign-era email (Stellr's sender) for any tenant row.
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(finished).toMatchObject({ processed: 3, eligible: 4, tenantHeld: 1 })
    expect(Object.keys(finished.tenants as Row).sort()).toEqual([STELLR_TENANT_ID, A, B].sort())
    expect(h.fails).toEqual([])
  })

  it('flag on: a tenant with no usable sender claims nothing, sends nothing, and is recorded; the next tenant still runs', async () => {
    const fake = remindersDb([env('q1', 'native', NO_SENDER), env('a1', 'native', A)])
    h.db = fake.db
    const { finished } = await runReminders(true)
    expect(reminded()).toEqual(['a1'])
    expect(h.fails).toEqual([`t:${NO_SENDER}:sender`])
    // Only A's envelope was claimed.
    const claims = fake.calls.filter((c) => c.table === 'agreements' && c.op === 'update')
    expect(claims.map((c) => c.filters.find((f) => f.method === 'eq')?.args[1])).toEqual(['a1'])
    expect(finished).toMatchObject({ processed: 1, eligible: 2 })
  })

  it('flag on: a tenant whose sender is gone by the time the engine reads it gets its reminder slot back', async () => {
    const fake = remindersDb([{ ...env('a1', 'native', A), reminder_count: 1, reminder_sent_at: '2026-10-01T00:00:00.000Z' }, env('b1', 'native', B)])
    h.db = fake.db
    h.remind.mockImplementation(async (_db: unknown, row: { id: string }) => {
      // The same module instance the route was loaded with.
      const { TenantSenderRequiredError } = await import('@/lib/event-emails/tenant-mail')
      if (row.id === 'a1') throw new TenantSenderRequiredError()
      return 1
    })
    const { finished } = await runReminders(true)
    expect(reminded()).toEqual(['a1', 'b1'])
    expect(h.fails).toEqual([`t:${A}:a1`])
    expect(finished).toMatchObject({ processed: 1 })
    const updates = fake.calls.filter((c) => c.table === 'agreements' && c.op === 'update')
    const a1 = updates.filter((c) => c.filters.find((f) => f.method === 'eq')?.args[1] === 'a1')
    expect(a1).toHaveLength(2)
    const claim = a1[0].payload as { reminder_sent_at: string }
    expect(a1[1].payload).toEqual({ reminder_sent_at: '2026-10-01T00:00:00.000Z', reminder_count: 1 })
    expect(a1[1].filters.filter((f) => f.method === 'eq').map((f) => f.args)).toEqual([
      ['id', 'a1'],
      ['reminder_count', 2],
      ['reminder_sent_at', claim.reminder_sent_at],
    ])
    // b1 was claimed once and not given back.
    expect(updates.filter((c) => c.filters.find((f) => f.method === 'eq')?.args[1] === 'b1')).toHaveLength(1)
  })

  it('any other failure keeps the claim, as before', async () => {
    const fake = remindersDb([env('a1', 'native', A)])
    h.db = fake.db
    h.remind.mockImplementation(async () => { throw new Error('engine down') })
    await runReminders(true)
    expect(fake.calls.filter((c) => c.table === 'agreements' && c.op === 'update')).toHaveLength(1)
  })

  it('flag on: a tenant whose chase throws is recorded under its id, and the next tenant still runs', async () => {
    h.db = remindersDb([env('a1', 'native', A), env('b1', 'native', B)]).db
    h.remind.mockImplementation(async (_db: unknown, row: { id: string }) => {
      if (row.id === 'a1') throw new Error('engine down')
      return 1
    })
    const { finished } = await runReminders(true)
    expect(reminded()).toEqual(['a1', 'b1'])
    expect(h.fails).toEqual([`t:${A}:a1`])
    expect(finished).toMatchObject({ processed: 1 })
  })

  it.each([['TRUE'], ['1'], ['yes']])('flag %s is not exactly true: every tenant row is held', async (value) => {
    h.db = remindersDb([env('s1', 'native', null), env('a1', 'native', A)]).db
    vi.resetModules()
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', value)
    const { GET } = await import('@/app/api/cron/docusign-reminders/route')
    await GET(new Request('https://example.test/api/cron/docusign-reminders') as never)
    expect(reminded()).toEqual(['s1'])
    expect(h.finished[0]).toMatchObject({ processed: 1, tenantHeld: 1 })
  })

  it('a Stellr failure keeps its label, and the next envelope still runs', async () => {
    h.db = remindersDb([env('s1', 'docusign', null), env('s2', 'native', null)]).db
    h.remind.mockImplementation(async (_db: unknown, row: { id: string }) => {
      if (row.id === 's1') throw new Error('engine down')
      return 1
    })
    const { finished } = await runReminders(false)
    expect(reminded()).toEqual(['s1', 's2'])
    expect(h.fails).toEqual(['s1'])
    expect(finished).toMatchObject({ processed: 1 })
  })

  it('stops starting chases once the 90 s budget has gone, and counts the rest as deferred', async () => {
    let clock = 5_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    h.db = remindersDb([env('s1', 'docusign', null), env('s2', 'docusign', null), env('s3', 'native', null)]).db
    h.remind.mockImplementation(async (_db: unknown, row: { id: string }) => {
      if (row.id === 's1') clock += 91_000
      return 1
    })
    const { finished } = await runReminders(false)
    expect(reminded()).toEqual(['s1'])
    expect(finished).toMatchObject({ processed: 1, deferred: 2 })
  })
})

describe('the B14 crons match lib/cron-scope.ts', () => {
  const read = (path: string) => readFileSync(path, 'utf8')
  it.each([
    ['event-emails', 'app/api/cron/event-emails/route.ts'],
    ['docusign-reminders', 'app/api/cron/docusign-reminders/route.ts'],
  ])('%s is per_tenant, runs through runPerTenant, and keeps the default fairness', (job, path) => {
    expect(CRON_SCOPES[job].scope).toBe('per_tenant')
    expect(read(path)).toMatch(/runPerTenant[<(]/)
    expect(read(path)).toContain(`job: '${job}'`)
    expect(read(path)).not.toMatch(/fairness:/)
    // Outbound mail never reaches suspended or archived tenants.
    expect(read(path)).not.toContain('includeInactive')
  })
})
