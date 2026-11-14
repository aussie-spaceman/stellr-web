// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import { CRON_SCOPES } from '@/lib/cron-scope'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { STELLR_OR_NULL } from '@/lib/tenancy/stellr-scope'
import { fakeChainDb, type ChainCall, type Row } from '@/test/helpers/fake-chain-db'

// S5 B22: group-invoice-sync runs per tenant and fails closed for every tenant
// but Stellr until S9. Stellr's run makes the same Stripe calls and the same
// writes as the sweeps it replaces (syncDueGroupInvoices and settleDueShares,
// run here as the "before"), returns the same result keys and reads no tenants.
// Another tenant's due rows never reach Stripe and are counted as held. The run
// stops starting registrations at its deadline, and a failed held read does not
// stop Stellr's work.

const h = vi.hoisted(() => ({
  db: null as unknown,
  stripe: null as unknown,
  finished: [] as Row[],
  fails: [] as string[],
  notify: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: () => {},
}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => h.db }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => h.stripe }))
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
vi.mock('@/lib/after-response', () => ({ runAfterResponse: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notifyCommunityAdmins: h.notify }))
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: vi.fn() }))
vi.mock('@/lib/events/repo', () => ({
  getEventBySlug: async (slug: string) => ({ date: slug === 'ev-over' ? '2026-11-01' : '2099-01-01', stripePriceId: 'price_event' }),
}))

const A = '11111111-1111-4111-8111-111111111111'
const DUE_AT = '2020-01-01T00:00:00.000Z'

// ── Fixture ─────────────────────────────────────────────────────────────────
// g1: an open invoice for 2 places on a group that now has none, so it is voided
//     (a Stripe retrieve and a void). g2: no invoice asked for, so nothing to do.
// s1: a sharing group whose event is over: the share falls from 50.00 to 25.00,
//     so four students each get 25.00 back. s2: its event is still to come.
// gA, sA: the same kinds of rows on tenant A.

type Reg = Row & { id: string; tenant_id: string | null }

const groupReg = (id: string, tenant: string | null, invoiceRequested: boolean): Reg => ({
  id, tenant_id: tenant, type: 'group', event_slug: `ev-${id}`, event_title: 'Group event', status: 'registered',
  invoice_requested: invoiceRequested, invoice_paid_at: null, member_pays_individually: false, stripe_payment_intent_id: null,
  amount_due_cents: 0, adult_count: 0, student_count: 0, teacher_first_name: 'Teacher', teacher_last_name: 'One',
  teacher_email: 'teacher@example.org', teacher_member_id: null, invoice_coupon_id: null, invoice_promotion_code: null,
  late_joiner_payer: null, share_estimate: null, share_first_paid_at: null, invoice_sync_due_at: DUE_AT,
})

const shareReg = (id: string, tenant: string | null, eventSlug: string): Reg => ({
  id, tenant_id: tenant, event_slug: eventSlug, event_title: 'Sharing event', member_pays_individually: false, late_joiner_payer: null,
  share_estimate: 2, share_unit_cents: 10_000, share_cents: 5_000, share_first_paid_at: '2026-10-01T00:00:00.000Z', share_settled_at: null,
})

const student = (id: string) => ({
  id, payer: 'self', individual_payment_status: 'paid', event_role: 'participant', share_paid_cents: 5_000,
  stripe_payment_intent_id: `pi_${id}`, member_id: null,
})
const SHARE_PEOPLE = [
  { id: 'p-adult', payer: 'shared', individual_payment_status: 'covered', event_role: 'teacher', share_paid_cents: null, stripe_payment_intent_id: null, member_id: null },
  student('p1'), student('p2'), student('p3'), student('p4'),
]

const LEDGER: Record<string, Row[]> = {
  g1: [{ id: 'gi-1', registration_id: 'g1', kind: 'seats', status: 'open', seats: 2, per_seat_cents: 10_000, stripe_invoice_id: 'in_g1', created_at: DUE_AT }],
  gA: [{ id: 'gi-A', registration_id: 'gA', kind: 'seats', status: 'open', seats: 2, per_seat_cents: 10_000, stripe_invoice_id: 'in_gA', created_at: DUE_AT }],
}

const STELLR_INVOICES = [groupReg('g1', null, true), groupReg('g2', STELLR_TENANT_ID, false)]
const STELLR_SHARES = [shareReg('s1', null, 'ev-over'), shareReg('s2', STELLR_TENANT_ID, 'ev-future')]
const TENANT_INVOICES = [groupReg('gA', A, true)]
const TENANT_SHARES = [shareReg('sA', A, 'ev-over')]

const isStellr = (r: Reg) => r.tenant_id === null || r.tenant_id === STELLR_TENANT_ID
const eqArg = (call: ChainCall, column: string) => call.filters.find((f) => f.method === 'eq' && f.args[0] === column)?.args[1]
const notOn = (call: ChainCall, column: string) => call.filters.some((f) => f.method === 'not' && f.args[0] === column)
const pick = (row: Row, columns: string) => Object.fromEntries(columns.split(',').map((c) => c.trim()).map((c) => [c, row[c]]))

interface DbOptions {
  /** Answer the sweep reads with every row, as if the tenant filter were missing. */
  ignoreTenantFilter?: boolean
  /** Fail the reads of other tenants' held rows. */
  heldReadError?: boolean
  /** Fail the invoice sweep read. */
  invoiceSweepError?: boolean
  /** Fail the share sweep read. */
  shareSweepError?: boolean
}

function billingDb(invoices: Reg[], shares: Reg[], opts: DbOptions = {}) {
  const regs = new Map([...invoices, ...shares].map((r) => [r.id, r]))
  const sweep = (call: ChainCall, rows: Reg[]) => {
    if (call.filters.some((f) => f.method === 'neq' && f.args[0] === 'tenant_id')) {
      return opts.heldReadError ? { data: null, error: { message: 'held read failed' } } : { data: rows.filter((r) => !isStellr(r)), error: null }
    }
    const scoped = !opts.ignoreTenantFilter && call.filters.some((f) => f.method === 'or' && f.args[0] === STELLR_OR_NULL)
    return { data: (scoped ? rows.filter(isStellr) : rows).map((r) => pick(r, call.columns)), error: null }
  }
  return fakeChainDb((call: ChainCall) => {
    // Fresh copies each time: the billing code mutates what it reads.
    const copy = <T>(v: T) => ({ data: structuredClone(v), error: null })
    if (call.table === 'registrations' && call.op === 'select') {
      const held = call.filters.some((f) => f.method === 'neq' && f.args[0] === 'tenant_id')
      if (notOn(call, 'invoice_sync_due_at')) {
        return opts.invoiceSweepError && !held ? { data: null, error: { message: 'invoice sweep failed' } } : sweep(call, invoices)
      }
      if (notOn(call, 'share_estimate')) {
        return opts.shareSweepError && !held ? { data: null, error: { message: 'share sweep failed' } } : sweep(call, shares)
      }
      const reg = regs.get(eqArg(call, 'id') as string)
      if (!reg) return { data: null, error: null }
      return copy(call.columns === 'invoice_sync_due_at' ? { invoice_sync_due_at: reg.invoice_sync_due_at } : reg)
    }
    // withInvoiceLock: the lock update returns the locked row.
    if (call.table === 'registrations' && call.op === 'update' && call.columns === 'id') return copy([{ id: eqArg(call, 'id') }])
    if (call.table === 'group_invoices' && call.op === 'select') return copy(LEDGER[eqArg(call, 'registration_id') as string] ?? [])
    if (call.table === 'participants' && call.op === 'select') {
      const id = eqArg(call, 'registration_id') as string
      return copy(id.startsWith('s') ? SHARE_PEOPLE : [])
    }
    return { data: null, error: null }
  })
}

/** Records every Stripe call, in order. */
function fakeStripe(clock?: { onRetrieve?: () => void }) {
  const calls: [string, unknown[]][] = []
  const answers: Record<string, (...args: unknown[]) => unknown> = {
    'invoices.retrieve': (id) => {
      clock?.onRetrieve?.()
      return { id, status: 'open', currency: 'usd', customer: 'cus_test', latest_revision: null, number: `INV-${id}` }
    },
    'invoices.voidInvoice': (id) => ({ id, status: 'void' }),
    'refunds.create': (params) => ({ id: `re_${(params as { metadata: { participant_id: string } }).metadata.participant_id}` }),
  }
  const resource = (name: string) =>
    new Proxy({}, {
      get: (_t, method) => async (...args: unknown[]) => {
        calls.push([`${name}.${String(method)}`, args])
        return answers[`${name}.${String(method)}`]?.(...args) ?? {}
      },
    })
  const stripe = new Proxy({}, { get: (_t, name) => resource(String(name)) }) as unknown as Stripe
  return { stripe, calls }
}

const writes = (calls: ChainCall[]) => calls.filter((c) => c.op !== 'select').map(({ table, op, payload, filters }) => ({ table, op, payload, filters }))
const isSweep = (c: ChainCall) => c.table === 'registrations' && c.op === 'select' && (notOn(c, 'invoice_sync_due_at') || notOn(c, 'share_estimate'))
const otherReads = (calls: ChainCall[]) => calls.filter((c) => c.op === 'select' && !isSweep(c))

async function runRoute() {
  vi.resetModules()
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
  const { GET } = await import('@/app/api/cron/group-invoice-sync/route')
  const res = await GET(new Request('https://example.test/api/cron/group-invoice-sync') as never)
  return { status: res.status, body: (await res.json()) as Row, finished: h.finished[0] }
}

/** The sweeps the route ran before B22, exactly as it called them. */
async function runBefore(db: unknown, stripe: Stripe) {
  vi.resetModules()
  const { syncDueGroupInvoices } = await import('@/lib/group-billing')
  const { settleDueShares } = await import('@/lib/teacher-share')
  const tally = await syncDueGroupInvoices(db as never, stripe)
  const shares = await settleDueShares(db as never, stripe)
  return { ...tally, ...Object.fromEntries(Object.entries(shares).map(([k, v]) => [`share_${k}`, v])) }
}

beforeEach(() => {
  h.finished = []
  h.fails = []
  h.notify.mockReset().mockImplementation(async () => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('group-invoice-sync, Stellr alone', () => {
  it('makes the same Stripe calls and writes, and returns the same result, as the sweeps it replaces', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-14T12:00:00Z'))

    const before = { db: billingDb(STELLR_INVOICES, STELLR_SHARES), stripe: fakeStripe() }
    const expected = await runBefore(before.db.db, before.stripe.stripe)

    const after = { db: billingDb(STELLR_INVOICES, STELLR_SHARES), stripe: fakeStripe() }
    h.db = after.db.db
    h.stripe = after.stripe.stripe
    const { status, body, finished } = await runRoute()

    expect(status).toBe(200)
    // The fixture does real work: a void, four refunds, a settled group.
    expect(expected).toEqual({ voided: 1, none: 1, share_settled: 1, share_not_due: 1, share_refunds: 4, share_refunds_failed: 0 })
    expect(before.stripe.calls.map(([name]) => name)).toEqual([
      'invoices.retrieve', 'invoices.voidInvoice', 'refunds.create', 'refunds.create', 'refunds.create', 'refunds.create',
    ])

    expect(after.stripe.calls).toEqual(before.stripe.calls)
    expect(writes(after.db.calls)).toEqual(writes(before.db.calls))
    expect(otherReads(after.db.calls).filter((c) => !c.filters.some((f) => f.method === 'neq' && f.args[0] === 'tenant_id')))
      .toEqual(otherReads(before.db.calls))
    expect(body).toEqual(expected)
    expect(finished).toEqual(expected)
    expect(h.fails).toEqual([])
    expect(h.notify.mock.calls).toEqual([])
  })

  it('reads Stellr’s rows with the tenant column, then counts other tenants’ rows; no tenants read, no ledger rows', async () => {
    const fake = billingDb(STELLR_INVOICES, STELLR_SHARES)
    h.db = fake.db
    h.stripe = fakeStripe().stripe
    await runRoute()
    const sweeps = fake.calls.filter(isSweep)
    expect(sweeps.map((c) => c.columns)).toEqual(['id, tenant_id', 'id, event_slug, tenant_id', 'id, tenant_id', 'id, tenant_id'])
    // Stellr's two passes: Stellr's rows (NULL counts as Stellr), 50 at most, as before.
    for (const c of sweeps.slice(0, 2)) {
      expect(c.filters).toContainEqual({ method: 'or', args: [STELLR_OR_NULL] })
      expect(c.filters).toContainEqual({ method: 'limit', args: [50] })
    }
    // The held counts: another tenant's id only.
    for (const c of sweeps.slice(2)) {
      expect(c.filters).toContainEqual({ method: 'not', args: ['tenant_id', 'is', null] })
      expect(c.filters).toContainEqual({ method: 'neq', args: ['tenant_id', STELLR_TENANT_ID] })
    }
    expect(fake.calls.filter((c) => c.table === 'tenants' || c.table === 'cron_runs')).toEqual([])
  })

  it('a quiet run still writes the share tally, with no held counts and no ledger', async () => {
    h.db = billingDb([], []).db
    h.stripe = fakeStripe().stripe
    const { body, finished } = await runRoute()
    const quiet = { share_settled: 0, share_not_due: 0, share_refunds: 0, share_refunds_failed: 0 }
    expect(body).toEqual(quiet)
    expect(finished).toEqual(quiet)
  })

  it('a failed invoice sweep ends the run as before: a 500, the sync label, an empty result', async () => {
    h.db = billingDb(STELLR_INVOICES, STELLR_SHARES, { invoiceSweepError: true }).db
    const stripe = fakeStripe()
    h.stripe = stripe.stripe
    const { status, body, finished } = await runRoute()
    expect(status).toBe(500)
    expect(body).toEqual({ error: 'invoice sweep failed' })
    expect(h.fails).toEqual(['sync'])
    expect(finished).toEqual({})
    expect(stripe.calls).toEqual([])
  })

  it('a failed share sweep keeps the invoice tally and its label, as before', async () => {
    h.db = billingDb(STELLR_INVOICES, STELLR_SHARES, { shareSweepError: true }).db
    h.stripe = fakeStripe().stripe
    const { status, finished } = await runRoute()
    expect(status).toBe(200)
    expect(h.fails).toEqual(['share-settle'])
    expect(finished).toEqual({ voided: 1, none: 1 })
  })
})

describe('group-invoice-sync with another tenant’s rows', () => {
  it('runs Stellr’s rows, holds the tenant’s without touching Stripe or the rows, and counts them', async () => {
    const fake = billingDb([...STELLR_INVOICES, ...TENANT_INVOICES], [...STELLR_SHARES, ...TENANT_SHARES])
    h.db = fake.db
    const stripe = fakeStripe()
    h.stripe = stripe.stripe
    const { status, finished } = await runRoute()
    expect(status).toBe(200)
    expect(finished).toEqual({
      voided: 1, none: 1, share_settled: 1, share_not_due: 1, share_refunds: 4, share_refunds_failed: 0,
      tenantHeld: 1, share_tenantHeld: 1,
    })
    expect(stripe.calls.some(([, args]) => JSON.stringify(args).includes('gA') || JSON.stringify(args).includes('sA'))).toBe(false)
    expect(stripe.calls.filter(([name]) => name === 'invoices.retrieve').map(([, args]) => args[0])).toEqual(['in_g1'])
    // Nothing of the tenant's was read one by one, locked, cleared or settled.
    const touched = fake.calls.filter((c) => !isSweep(c) && JSON.stringify(c.filters).match(/"(gA|sA)"/))
    expect(touched).toEqual([])
    // Still no tenants read and no per-tenant ledger: only Stellr ran.
    expect(fake.calls.filter((c) => c.table === 'tenants' || c.table === 'cron_runs')).toEqual([])
    expect(finished.tenants).toBeUndefined()
    expect(h.fails).toEqual([])
  })

  it('a tenant row that reaches Stellr’s read anyway is partitioned out and left alone', async () => {
    const fake = billingDb([...STELLR_INVOICES, ...TENANT_INVOICES], [...STELLR_SHARES, ...TENANT_SHARES], { ignoreTenantFilter: true })
    h.db = fake.db
    const stripe = fakeStripe()
    h.stripe = stripe.stripe
    const { finished } = await runRoute()
    expect(stripe.calls.filter(([name]) => name === 'invoices.retrieve').map(([, args]) => args[0])).toEqual(['in_g1'])
    expect(fake.calls.filter((c) => !isSweep(c) && JSON.stringify(c.filters).match(/"(gA|sA)"/))).toEqual([])
    expect(finished).toMatchObject({ voided: 1, none: 1, share_settled: 1, tenantHeld: 1, share_tenantHeld: 1 })
  })

  it('a failed held read is recorded and Stellr’s work and result still land', async () => {
    h.db = billingDb([...STELLR_INVOICES, ...TENANT_INVOICES], [...STELLR_SHARES, ...TENANT_SHARES], { heldReadError: true }).db
    const stripe = fakeStripe()
    h.stripe = stripe.stripe
    const { status, finished } = await runRoute()
    expect(status).toBe(200)
    expect(h.fails).toEqual(['tenant-held', 'share-tenant-held'])
    expect(finished).toEqual({ voided: 1, none: 1, share_settled: 1, share_not_due: 1, share_refunds: 4, share_refunds_failed: 0 })
    expect(stripe.calls.filter(([name]) => name === 'refunds.create')).toHaveLength(4)
  })
})

describe('group-invoice-sync deadline', () => {
  it('stops starting registrations once the 270 s budget has gone, and counts the rest as deferred', async () => {
    // The clock stands still except while g1's invoice is fetched, which runs
    // past the budget: g2 and both sharing groups wait for the next run.
    let clock = Date.parse('2026-11-14T12:00:00Z')
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const fake = billingDb(STELLR_INVOICES, STELLR_SHARES)
    h.db = fake.db
    const stripe = fakeStripe({ onRetrieve: () => { clock += 271_000 } })
    h.stripe = stripe.stripe
    const { status, finished } = await runRoute()
    expect(status).toBe(200)
    expect(finished).toEqual({ voided: 1, deferred: 1, share_settled: 0, share_not_due: 0, share_refunds: 0, share_refunds_failed: 0, share_deferred: 2 })
    expect(stripe.calls.map(([name]) => name)).toEqual(['invoices.retrieve', 'invoices.voidInvoice'])
    // g2 was never locked or read; the sharing groups were never loaded.
    expect(fake.calls.filter((c) => !isSweep(c) && JSON.stringify(c.filters).match(/"(g2|s1|s2)"/))).toEqual([])
  })
})

describe('group-invoice-sync matches lib/cron-scope.ts', () => {
  const src = readFileSync('app/api/cron/group-invoice-sync/route.ts', 'utf8')
  const code = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

  it('is per_tenant, names its slice, runs through runPerTenant, and keeps the default fairness', () => {
    expect(CRON_SCOPES['group-invoice-sync'].scope).toBe('per_tenant')
    expect(CRON_SCOPES['group-invoice-sync'].why).toContain('B22')
    expect(code).toMatch(/runPerTenant[<(]/)
    expect(code).toContain("job: 'group-invoice-sync'")
    expect(code).not.toMatch(/fairness:/)
    // Money work never reaches suspended or archived tenants.
    expect(code).not.toContain('includeInactive')
  })

  it('takes the tenant from the rows only, never from the request', () => {
    expect(code).not.toMatch(/headers|host|tenantFrom|resolveTenant/i)
    expect(code).toContain('partitionByTenant')
  })

  it('no longer calls the unpartitioned sweeps', () => {
    expect(code).not.toMatch(/syncDueGroupInvoices|settleDueShares/)
  })
})
