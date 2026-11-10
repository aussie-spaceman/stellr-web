// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { fakeChainDb, type ChainCall } from '@/test/helpers/fake-chain-db'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { STELLR_OR_NULL } from '@/lib/tenancy/stellr-scope'

// S5 B14 follow-up: the native signing engine's tenant sender. Another tenant's
// envelope is invited and reminded only from "<Tenant> via Stellr" with the
// tenant's Reply-To, and only while TENANT_EVENT_MAIL_ENABLED is exactly true;
// without a usable sender nothing is sent, claimed or written. Stellr's
// envelopes send exactly what they sent before, flag or no flag.
//
// These run the real outbox, provider, tenant-mail and loaders against an
// in-memory database; only the final sendEmail is a spy.

const { sendEmail, announceBounces } = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_o: Record<string, unknown>) => ({ id: 're_1' }) as { id: string | null; suppressed?: true }),
  announceBounces: vi.fn(async () => 1),
}))
vi.mock('@/lib/email', async (orig) => ({ ...(await orig<typeof import('@/lib/email')>()), sendEmail }))
vi.mock('@/lib/esign/bounce-notices', () => ({ announceBounces }))

const { sendInvites, drainOutbox, outboxDepth } = await import('./outbox')
const { nativeProvider } = await import('./providers/native')
const { TenantSenderRequiredError, TENANT_SENDER_REQUIRED } = await import('@/lib/event-emails/tenant-mail')

const ROCKET = '11111111-1111-4111-8111-111111111111'
const QUIET = '33333333-3333-4333-8333-333333333333'
const TENANTS = [
  { id: STELLR_TENANT_ID, display_name: 'Stellr Education', branding: {} },
  { id: ROCKET, display_name: 'Rocket Club', branding: { reply_to: 'events@rocket.example.org' } },
  // No Reply-To: no sender.
  { id: QUIET, display_name: 'Quiet Org', branding: {} },
]
const ROCKET_FROM = '"Rocket Club via Stellr" <no-reply@mail.stellreducation.org>'

const envelope = (id: string, tenant: string | null | undefined, over: Record<string, unknown> = {}) => ({
  id, envelope_id: `native-${id}`, provider: 'native', envelope_type: 'minor', event_title: 'Launch Day',
  minor_name: 'Kid', status: 'sent', prefill: { MinorName: 'Kid' }, ...(tenant === undefined ? {} : { tenant_id: tenant }), ...over,
})
let n = 0
const signer = (envelopeRow: string, over: Record<string, unknown> = {}) => {
  n++
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    envelope_row: envelopeRow, recipient_id: '1', role_name: 'Guardian', name: 'Pat Lee', email: `pat${n}@x.test`,
    status: 'sent', routing_order: 1, member_id: null, token_version: 1,
    token_expires_at: new Date(Date.now() + 86_400_000).toISOString(), invite_sent_at: null, invite_attempts: 0,
    delivered_at: null, signed_at: null, declined_at: null, signer_values: null, ...over,
  }
}

function setup(agreements: object[], recipients: object[], opts: { tenantsFail?: boolean } = {}) {
  const db = fakeSupabase(
    { agreements, agreement_recipients: recipients, tenants: TENANTS },
    { failOn: (table) => (opts.tenantsFail && table === 'tenants' ? 'tenants unreadable' : null) },
  )
  const claims = { n: 0 }
  db.rpcs.esign_claim_email = () => (claims.n++, true)
  db.rpcs.esign_append_audit = () => ({ id: 1 })
  return { db, claims }
}

const flag = (on: boolean | string) => vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', on === true ? 'true' : on === false ? '' : on)

beforeEach(() => {
  n = 0
  vi.stubEnv('ESIGN_TOKEN_SECRET', 'k'.repeat(48))
  sendEmail.mockReset()
  sendEmail.mockResolvedValue({ id: 're_1' })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('Stellr’s signing mail is unchanged', () => {
  it.each([[null], [STELLR_TENANT_ID], [undefined]])('envelope tenant %s: same message with the flag off and on, no sender keys, no tenants read', async (tenant) => {
    const messages: unknown[] = []
    for (const on of [false, true]) {
      n = 0
      flag(on)
      sendEmail.mockClear()
      const { db, claims } = setup([envelope('e1', tenant)], [signer('e1')])
      const result = await sendInvites(db.client, db.table('agreement_recipients') as never, { now: new Date('2026-11-10T12:00:00Z') })
      expect(result).toEqual({ sent: 1, deferred: 0, failed: 0 })
      expect(claims.n).toBe(1)
      const msg = sendEmail.mock.calls[0][0]
      expect(msg).not.toHaveProperty('from')
      expect(msg).not.toHaveProperty('replyTo')
      expect(msg).toMatchObject({ critical: true, deferOnFailure: false })
      messages.push(msg)
    }
    expect(messages[1]).toEqual(messages[0])
  })
})

describe('another tenant’s invitation', () => {
  it('flag on: goes from the tenant’s sender with its Reply-To, still critical, on the shared budget', async () => {
    flag(true)
    const { db, claims } = setup([envelope('e1', ROCKET)], [signer('e1')])
    const rows = db.table('agreement_recipients')
    const result = await sendInvites(db.client, rows as never)
    expect(result).toEqual({ sent: 1, deferred: 0, failed: 0 })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][0]).toMatchObject({
      to: 'pat1@x.test', from: ROCKET_FROM, replyTo: 'events@rocket.example.org', critical: true, deferOnFailure: false,
    })
    expect(claims.n).toBe(1)
    expect(rows[0].invite_sent_at).toBeTruthy()
  })

  it.each([
    ['the flag is off', false, ROCKET, {}],
    ['the flag is not exactly true', 'TRUE', ROCKET, {}],
    ['the tenant has no Reply-To', true, QUIET, {}],
    ['the tenant cannot be read', true, ROCKET, { tenantsFail: true }],
  ])('held when %s: nothing sent, no budget claimed, nothing written', async (_what, on, tenant, opts) => {
    flag(on as boolean | string)
    const { db, claims } = setup([envelope('e1', tenant as string)], [signer('e1')], opts)
    const rows = db.table('agreement_recipients')
    const before = JSON.stringify(rows)
    expect(await sendInvites(db.client, rows as never)).toEqual({ sent: 0, deferred: 0, failed: 0, held: 1 })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(claims.n).toBe(0)
    expect(JSON.stringify(rows)).toBe(before)
  })

  it('a parent with a Stellr form and a tenant form gets two emails, each from its own sender, never one bundle', async () => {
    flag(true)
    const stellrRow = signer('stellr-env', { email: 'pat@x.test' })
    const tenantRow = signer('rocket-env', { email: 'Pat@x.test' })
    const { db, claims } = setup([envelope('stellr-env', null), envelope('rocket-env', ROCKET)], [stellrRow, tenantRow])
    expect(await sendInvites(db.client, db.table('agreement_recipients') as never)).toEqual({ sent: 2, deferred: 0, failed: 0 })
    expect(sendEmail).toHaveBeenCalledTimes(2)
    const [first, second] = sendEmail.mock.calls.map((c) => c[0])
    expect(first).not.toHaveProperty('from')
    expect(second).toMatchObject({ from: ROCKET_FROM, replyTo: 'events@rocket.example.org' })
    expect(claims.n).toBe(2)
  })

  it('flag off: the same parent gets the Stellr form; the tenant form is held', async () => {
    flag(false)
    const { db, claims } = setup(
      [envelope('stellr-env', null), envelope('rocket-env', ROCKET)],
      [signer('stellr-env', { email: 'pat@x.test' }), signer('rocket-env', { email: 'pat@x.test' })],
    )
    const rows = db.table('agreement_recipients')
    expect(await sendInvites(db.client, rows as never)).toEqual({ sent: 1, deferred: 0, failed: 0, held: 1 })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][0]).not.toHaveProperty('from')
    expect(claims.n).toBe(1)
    expect(rows.find((r) => r.envelope_row === 'rocket-env')?.invite_sent_at).toBeNull()
  })
})

describe('remind', () => {
  it('Stellr: renews the link and sends the reminder from Stellr’s sender, reading no tenant', async () => {
    flag(true)
    const { db } = setup([envelope('e1', null)], [signer('e1')])
    const read = vi.spyOn(db.client as unknown as { from: (t: string) => unknown }, 'from')
    expect(await nativeProvider.remind({ db: db.client }, 'native-e1')).toBe(1)
    expect(read.mock.calls.map((c) => c[0])).not.toContain('tenants')
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][0]).not.toHaveProperty('from')
    expect(String(sendEmail.mock.calls[0][0].subject)).toMatch(/^Reminder:/)
  })

  it('a tenant with a sender: the reminder goes from that sender', async () => {
    flag(true)
    const { db } = setup([envelope('e1', ROCKET)], [signer('e1', { invite_sent_at: '2026-11-01T00:00:00Z' })])
    expect(await nativeProvider.remind({ db: db.client }, 'native-e1')).toBe(1)
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ from: ROCKET_FROM, replyTo: 'events@rocket.example.org' })
  })

  it('a tenant with a sender: the sender it checked is the one the reminder uses, with no second read that could fail', async () => {
    flag(true)
    let reads = 0
    const db = fakeSupabase(
      { agreements: [envelope('e1', ROCKET)], agreement_recipients: [signer('e1', { invite_sent_at: '2026-11-01T00:00:00Z' })], tenants: TENANTS },
      { failOn: (table) => (table === 'tenants' && ++reads > 1 ? 'tenants unreadable' : null) },
    )
    db.rpcs.esign_claim_email = () => true
    db.rpcs.esign_append_audit = () => ({ id: 1 })
    expect(await nativeProvider.remind({ db: db.client }, 'native-e1')).toBe(1)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ from: ROCKET_FROM, replyTo: 'events@rocket.example.org' })
    expect(reads).toBe(1)
  })

  it.each([
    ['the flag is off', false, ROCKET],
    ['the tenant has no sender', true, QUIET],
  ])('refuses when %s, before renewing any link or writing the audit row', async (_what, on, tenant) => {
    flag(on as boolean)
    const { db } = setup([envelope('e1', tenant as string)], [signer('e1', { invite_sent_at: '2026-11-01T00:00:00Z' })])
    const audit = vi.fn(() => ({ id: 1 }))
    db.rpcs.esign_append_audit = audit
    const before = JSON.stringify(db.table('agreement_recipients'))
    const err = await nativeProvider.remind({ db: db.client }, 'native-e1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TenantSenderRequiredError)
    expect((err as Error).message).toBe(TENANT_SENDER_REQUIRED)
    expect((err as { status: number }).status).toBe(503)
    expect(JSON.stringify(db.table('agreement_recipients'))).toBe(before)
    expect(audit).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

// ── drainOutbox: Stellr's signers on their own read, first ────────────────────

// Answers like PostgREST would for the filters the outbox sends: the tenants'
// read keeps only the signers whose envelope's tenant is in its `in` list (when
// it sends one), then applies its limit.
function drainDb(waiting: { stellr: object[]; tenants: object[] }, agreements: Record<string, unknown>[], opts: { tenantsFail?: boolean } = {}) {
  return fakeChainDb(
    (call: ChainCall) => {
      if (call.table === 'agreement_recipients' && call.op === 'select') {
        if (call.filters.some((f) => f.method === 'or')) return { data: waiting.stellr, error: null }
        const only = call.filters.find((f) => f.method === 'in' && f.args[0] === 'envelope.tenant_id')?.args[1] as string[] | undefined
        const limit = call.filters.find((f) => f.method === 'limit')?.args[0] as number | undefined
        const tenantOf = (s: object) => agreements.find((a) => a.id === (s as { envelope_row: string }).envelope_row)?.tenant_id as string
        const rows = (waiting.tenants as object[]).filter((s) => !only || only.includes(tenantOf(s)))
        return { data: limit === undefined ? rows : rows.slice(0, limit), error: null }
      }
      if (call.table === 'tenants' && !call.single) {
        if (opts.tenantsFail) return { data: null, error: { message: 'tenants unreadable' } }
        const not = call.filters.find((f) => f.method === 'neq')?.args[1]
        return { data: TENANTS.filter((t) => t.id !== not), error: null }
      }
      if (call.table === 'agreements' && call.single) {
        const id = call.filters.find((f) => f.method === 'eq')?.args[1]
        return { data: agreements.find((a) => a.id === id) ?? null, error: null }
      }
      if (call.table === 'tenants' && call.single) {
        const id = call.filters.find((f) => f.method === 'eq')?.args[1]
        return { data: TENANTS.find((t) => t.id === id) ?? null, error: null }
      }
      return { data: null, error: null }
    },
    (fn) => ({ data: fn === 'esign_claim_email' ? true : { id: 1 }, error: null }),
  )
}

describe('drainOutbox', () => {
  it('flag off: one read, limited to Stellr’s envelopes, and the same result shape as before', async () => {
    flag(false)
    const fake = drainDb({ stellr: [signer('s1')], tenants: [signer('t1')] }, [envelope('s1', null), envelope('t1', ROCKET)])
    const result = await drainOutbox(fake.db)
    expect(result).toEqual({ sent: 1, deferred: 0, failed: 0, waiting: 1 })
    const reads = fake.calls.filter((c) => c.table === 'agreement_recipients' && c.op === 'select')
    expect(reads).toHaveLength(1)
    expect(reads[0].filters.find((f) => f.method === 'or')?.args).toEqual([STELLR_OR_NULL, { referencedTable: 'envelope' }])
    expect(reads[0].filters.find((f) => f.method === 'limit')?.args).toEqual([50])
    expect(fake.calls.some((c) => c.table === 'tenants')).toBe(false)
  })

  it('flag off with nothing waiting: the same empty result', async () => {
    flag(false)
    expect(await drainOutbox(drainDb({ stellr: [], tenants: [] }, []).db)).toEqual({ sent: 0, deferred: 0, failed: 0, waiting: 0 })
  })

  it('flag on: Stellr’s signers go first, then other tenants’ from their own senders; a sender-less tenant’s are not read', async () => {
    flag(true)
    const fake = drainDb(
      { stellr: [signer('s1')], tenants: [signer('r1'), signer('q1')] },
      [envelope('s1', null), envelope('r1', ROCKET), envelope('q1', QUIET)],
    )
    const result = await drainOutbox(fake.db, { limit: 20 })
    expect(result).toEqual({ sent: 2, deferred: 0, failed: 0, waiting: 2 })
    expect(sendEmail.mock.calls.map((c) => c[0].from ?? 'stellr')).toEqual(['stellr', ROCKET_FROM])
    const reads = fake.calls.filter((c) => c.table === 'agreement_recipients' && c.op === 'select')
    expect(reads).toHaveLength(2)
    expect(reads[1].filters.filter((f) => ['not', 'neq', 'in'].includes(f.method) && f.args[0] === 'envelope.tenant_id').map((f) => f.args)).toEqual([
      ['envelope.tenant_id', 'is', null],
      ['envelope.tenant_id', STELLR_TENANT_ID],
      ['envelope.tenant_id', [ROCKET]],
    ])
    expect(reads.map((r) => r.filters.find((f) => f.method === 'limit')?.args[0])).toEqual([20, 20])
    // One read of the tenants table, and no second read of Rocket's sender.
    expect(fake.calls.filter((c) => c.table === 'tenants')).toHaveLength(1)
  })

  it('flag on: a tenant without a sender and a full batch of waiting signers cannot keep another tenant’s in the outbox', async () => {
    flag(true)
    const quiet = Array.from({ length: 20 }, (_, i) => signer(`q${i}`))
    const fake = drainDb(
      { stellr: [], tenants: [...quiet, signer('r1')] },
      [...quiet.map((_, i) => envelope(`q${i}`, QUIET)), envelope('r1', ROCKET)],
    )
    const result = await drainOutbox(fake.db, { limit: 20 })
    expect(result).toEqual({ sent: 1, deferred: 0, failed: 0, waiting: 1 })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ from: ROCKET_FROM, replyTo: 'events@rocket.example.org' })
  })

  it.each([
    ['the tenants table cannot be read', { tenantsFail: true }],
  ])('flag on: %s: Stellr’s are sent, no other tenant’s signers are read', async (_what, opts) => {
    flag(true)
    const fake = drainDb({ stellr: [signer('s1')], tenants: [signer('r1')] }, [envelope('s1', null), envelope('r1', ROCKET)], opts)
    expect(await drainOutbox(fake.db)).toEqual({ sent: 1, deferred: 0, failed: 0, waiting: 1 })
    expect(fake.calls.filter((c) => c.table === 'agreement_recipients' && c.op === 'select')).toHaveLength(1)
  })

  it('outboxDepth counts Stellr’s waiting signers only', async () => {
    const fake = drainDb({ stellr: [], tenants: [] }, [])
    await outboxDepth(fake.db)
    const read = fake.calls.find((c) => c.table === 'agreement_recipients')!
    expect(read.filters.find((f) => f.method === 'or')?.args).toEqual([STELLR_OR_NULL, { referencedTable: 'envelope' }])
  })
})
