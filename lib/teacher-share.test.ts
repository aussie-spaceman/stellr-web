import { describe, it, expect, vi, beforeEach } from 'vitest'

// Students share the teacher's cost (9 Nov 2026). These pin the owner's rules:
// teachers pay full price with no code; the share only goes down once someone has
// paid; the day after the event, early payers get the difference back; what isn't
// collected, Stellr absorbs.

vi.mock('server-only', () => ({}))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: vi.fn(async () => ({ stripePriceId: 'price_event', date: '2026-11-20' })) }))
vi.mock('@/lib/events/repo', () => ({ getEventBySlug: vi.fn(async () => ({ stripePriceId: 'price_event', date: '2026-11-20' })) }))
vi.mock('@/lib/notify', () => ({ notifyCommunityAdmins: vi.fn(async () => {}) }))
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: vi.fn() }))

import {
  createSharedSeatCheckout,
  eventIsOver,
  nextShare,
  recordSeatShare,
  refreshShare,
  seatCharge,
  settleDueShares,
  settleShare,
  shareCounts,
  shareFor,
  trueUpCents,
  unwindShares,
  type ShareGroup,
  type SharePerson,
} from './teacher-share'
import { payerOf } from './group-payer'

type Row = Record<string, unknown>

// ── Pure rules ───────────────────────────────────────────────────────────────

describe('the share', () => {
  it.each<[string, Parameters<typeof shareFor>[0], number]>([
    ['the estimate when fewer have joined', { poolCents: 9700, estimate: 4, students: 2 }, 2425],
    ['the students when more have joined', { poolCents: 9700, estimate: 4, students: 5 }, 1940],
    ['two teachers', { poolCents: 19_400, estimate: 10, students: 3 }, 1940],
    ['rounded down, never over the cost', { poolCents: 9700, estimate: 3, students: 0 }, 3233],
    ['no teacher, no share', { poolCents: 0, estimate: 4, students: 4 }, 0],
  ])('%s', (_name, input, expected) => {
    expect(shareFor(input)).toBe(expected)
  })

  it('follows the group until the first payment, then only goes down', () => {
    // Before anyone pays: an adult added raises it.
    expect(nextShare({ poolCents: 19_400, estimate: 4, students: 4, previous: 2425, firstPaid: false })).toBe(4850)
    // After: a student added lowers it…
    expect(nextShare({ poolCents: 9700, estimate: 4, students: 5, previous: 2425, firstPaid: true })).toBe(1940)
    // …and one removed leaves it.
    expect(nextShare({ poolCents: 9700, estimate: 4, students: 4, previous: 1940, firstPaid: true })).toBe(1940)
  })
})

describe('what a student pays', () => {
  it('a code discounts the place, never the share', () => {
    expect(seatCharge(9700, { percentOff: 15, amountOffCents: null }, 2425)).toMatchObject({
      discountCents: 1455, baseCents: 8245, shareCents: 2425, totalCents: 10_670, shareWaived: false,
    })
  })

  it('a full scholarship still pays the share', () => {
    expect(seatCharge(9700, { percentOff: 100, amountOffCents: null }, 2425)).toMatchObject({ baseCents: 0, shareCents: 2425, totalCents: 2425 })
  })

  it('a share too small to charge on an otherwise free place is waived', () => {
    expect(seatCharge(9700, { percentOff: 100, amountOffCents: null }, 40)).toMatchObject({ totalCents: 0, shareWaived: true })
  })

  it('a fixed-amount code is capped at the place', () => {
    expect(seatCharge(9700, { percentOff: null, amountOffCents: 20_000 }, 2425)).toMatchObject({ baseCents: 0, totalCents: 2425 })
  })

  it('the true-up is what was paid above the final share', () => {
    expect(trueUpCents(2425, 1940)).toBe(485)
    expect(trueUpCents(1940, 1940)).toBe(0)
    expect(trueUpCents(null, 1940)).toBe(0)
  })

  it('settles the day after the event, on its end date if it has one', () => {
    expect(eventIsOver({ date: '2026-11-20' }, new Date('2026-11-20T23:59:00Z'))).toBe(false)
    expect(eventIsOver({ date: '2026-11-20' }, new Date('2026-11-21T00:00:00Z'))).toBe(true)
    expect(eventIsOver({ date: '2026-11-20', endDate: '2026-11-21' }, new Date('2026-11-21T12:00:00Z'))).toBe(false)
    expect(eventIsOver(null)).toBe(false)
  })
})

const GROUP: ShareGroup = {
  id: 'reg-1', event_slug: 'msu', member_pays_individually: true, late_joiner_payer: null,
  share_estimate: 4, share_unit_cents: 9700, share_cents: null, share_first_paid_at: null, share_settled_at: null,
}
const teacher = (over: Partial<SharePerson> = {}): SharePerson => ({ id: 't', payer: 'shared', individual_payment_status: 'covered', event_role: 'teacher', share_paid_cents: null, ...over })
const student = (id: string, over: Partial<SharePerson> = {}): SharePerson => ({ id, payer: 'self', individual_payment_status: 'pending', event_role: 'participant', share_paid_cents: null, ...over })

describe('who is in the pool, and who shares it', () => {
  it('covered teachers fill the pool; a student who paid before the switch is not counted', () => {
    const people = [teacher(), student('s1'), student('s2'), student('s3', { individual_payment_status: 'paid', share_paid_cents: null })]
    expect(shareCounts(GROUP, people)).toEqual({ sharedAdults: 1, students: 2, poolCents: 9700 })
  })

  it('a student who paid a share is counted', () => {
    expect(shareCounts(GROUP, [teacher(), student('s1', { individual_payment_status: 'paid', share_paid_cents: 2425 })]).students).toBe(1)
  })

  it('a new adult folds in before anyone pays, and pays their own way after', () => {
    const newAdult = { payer: null, individual_payment_status: null, event_role: 'adult' }
    expect(payerOf(newAdult, GROUP)).toBe('shared')
    expect(payerOf(newAdult, { ...GROUP, share_first_paid_at: '2026-11-10T00:00:00Z' })).toBe('self')
    expect(payerOf({ payer: null, individual_payment_status: null, event_role: 'participant' }, GROUP)).toBe('self')
  })
})

// ── Against fakes ────────────────────────────────────────────────────────────

function fakeDb(tables: Record<string, Row[]>) {
  function builder(table: string) {
    const filters: [string, string, unknown][] = []
    let op: 'select' | 'update' | 'insert' = 'select'
    let values: Row = {}
    const match = (r: Row) => filters.every(([kind, col, val]) =>
      kind === 'eq' ? r[col] === val
        : kind === 'neq' ? r[col] !== val
          : kind === 'in' ? (val as unknown[]).includes(r[col])
            : kind === 'is' ? (r[col] ?? null) === val
              : kind === 'notnull' ? r[col] != null
                : true)
    const run = () => {
      const rows = (tables[table] ??= [])
      if (op === 'insert') { rows.push({ ...values }); return { data: null, error: null } }
      if (op === 'update') {
        const matched = rows.filter(match)
        matched.forEach((r) => Object.assign(r, values))
        return { data: matched, error: null }
      }
      return { data: rows.filter(match).map((r) => ({ ...r })), error: null }
    }
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push(['eq', c, v]), q),
      neq: (c: string, v: unknown) => (filters.push(['neq', c, v]), q),
      in: (c: string, v: unknown[]) => (filters.push(['in', c, v]), q),
      is: (c: string, v: unknown) => (filters.push(['is', c, v]), q),
      not: (c: string) => (filters.push(['notnull', c, null]), q),
      limit: () => q,
      update: (v: Row) => { op = 'update'; values = v; return q },
      insert: (v: Row) => { op = 'insert'; values = v; return q },
      maybeSingle: async () => ({ data: (run().data as Row[] | null)?.[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    }
    return q
  }
  return { from: builder } as never
}

function fakeStripe() {
  return {
    prices: { retrieve: vi.fn(async () => ({ unit_amount: 9700, currency: 'usd', product: 'prod_event' })) },
    refunds: { create: vi.fn(async (args: { amount: number }) => ({ id: `re_${args.amount}` })) },
    promotionCodes: { list: vi.fn(async ({ code }: { code: string }) => ({ data: code === 'STEMCAREERS' ? [{ code, coupon: 'co_15' }] : [] })) },
    coupons: {
      retrieve: vi.fn(async (id: string) => {
        if (id === 'co_15') return { id, valid: true, percent_off: 15, amount_off: null, applies_to: null }
        if (id === 'co_other') return { id, valid: true, percent_off: 10, amount_off: null, applies_to: { products: ['prod_other'] } }
        throw new Error('No such coupon')
      }),
    },
    checkout: { sessions: { create: vi.fn(async () => ({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' })) } },
  }
}

const REG_ROW = { ...GROUP, event_title: 'MSU Design Challenge', status: 'pending' }
const person = (id: string, over: Row = {}) => ({
  id, registration_id: 'reg-1', payer: 'self', individual_payment_status: 'pending', event_role: 'participant',
  share_paid_cents: null, base_paid_cents: null, stripe_payment_intent_id: null, member_id: null, ...over,
})

function setup(people: Row[], reg: Row = {}) {
  const tables: Record<string, Row[]> = {
    registrations: [{ ...REG_ROW, ...reg }],
    participants: people,
    event_refunds: [],
  }
  return { db: fakeDb(tables), tables, reg: tables.registrations[0], stripe: fakeStripe() }
}

beforeEach(() => vi.clearAllMocks())

describe('the worked example: one $97 teacher, an estimate of 4', () => {
  it('two pay $24.25, a fifth joins, one leaves, and the early payers get $4.85 back after the event', async () => {
    const f = setup([
      person('t', { payer: 'shared', individual_payment_status: 'covered', event_role: 'teacher' }),
      person('s1'), person('s2'), person('s3'), person('s4'),
    ])
    expect((await refreshShare(f.db, 'reg-1'))?.shareCents).toBe(2425)

    // s1 and s2 pay their share (the webhook records it from the session).
    for (const id of ['s1', 's2']) {
      Object.assign(f.tables.participants.find((p) => p.id === id) as Row, { individual_payment_status: 'paid', stripe_payment_intent_id: `pi_${id}` })
      await recordSeatShare(f.db, 'reg-1', id, { teacherShare: 'true', baseCents: '9700', shareCents: '2425' })
    }
    expect(f.reg.share_first_paid_at).toBeTruthy()

    f.tables.participants.push(person('s5'))
    expect((await refreshShare(f.db, 'reg-1'))?.shareCents).toBe(1940)

    f.tables.participants.splice(f.tables.participants.findIndex((p) => p.id === 's4'), 1)
    expect((await refreshShare(f.db, 'reg-1'))?.shareCents).toBe(1940) // never back up

    const out = await settleShare(f.db, f.stripe as never, 'reg-1')
    expect(out).toEqual({ refunded: 2, failed: 0 })
    expect(f.stripe.refunds.create.mock.calls.map((c) => [(c[0] as unknown as { payment_intent: string }).payment_intent, (c[0] as unknown as { amount: number }).amount]))
      .toEqual([['pi_s1', 485], ['pi_s2', 485]])
    expect(f.tables.event_refunds).toEqual([
      expect.objectContaining({ participant_id: 's1', refund_cents: 485, kind: 'share_true_up', refund_type: 'cash' }),
      expect.objectContaining({ participant_id: 's2', refund_cents: 485, kind: 'share_true_up', refund_type: 'cash' }),
    ])
    expect(f.reg.share_settled_at).toBeTruthy()

    // Settled: a re-run refunds nothing more.
    expect(await settleShare(f.db, f.stripe as never, 'reg-1')).toBeNull()
    expect(f.stripe.refunds.create).toHaveBeenCalledTimes(2)
  })

  it('an adult added before anyone pays is covered and the share rises once', async () => {
    const f = setup([
      person('t', { payer: 'shared', individual_payment_status: 'covered', event_role: 'teacher' }),
      person('a2', { payer: null, individual_payment_status: null, event_role: 'adult' }),
      person('s1'), person('s2'),
    ])
    expect((await refreshShare(f.db, 'reg-1'))?.shareCents).toBe(4850)
    expect(f.tables.participants[1]).toMatchObject({ payer: 'shared', individual_payment_status: 'covered' })
  })

  it('the daily sweep settles only groups whose event is over', async () => {
    const f = setup([person('t', { payer: 'shared', individual_payment_status: 'covered', event_role: 'teacher' }), person('s1')])
    vi.useFakeTimers({ now: new Date('2026-11-20T12:00:00Z') })
    expect(await settleDueShares(f.db, f.stripe as never)).toMatchObject({ settled: 0, not_due: 1 })
    vi.setSystemTime(new Date('2026-11-21T06:00:00Z'))
    expect(await settleDueShares(f.db, f.stripe as never)).toMatchObject({ settled: 1 })
    vi.useRealTimers()
  })
})

describe('leaving the shared cost', () => {
  it('refunds every share paid and uncovers the teacher', async () => {
    const f = setup([
      person('t', { payer: 'shared', individual_payment_status: 'covered', event_role: 'teacher' }),
      person('s1', { individual_payment_status: 'paid', share_paid_cents: 2425, stripe_payment_intent_id: 'pi_s1' }),
      person('s2'),
    ], { share_cents: 2425, share_first_paid_at: '2026-11-10T00:00:00Z' })
    expect(await unwindShares(f.db, f.stripe as never, 'reg-1')).toEqual({ refunded: 1, failed: 0 })
    expect(f.stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_s1', amount: 2425, metadata: expect.objectContaining({ source: 'stellr_app', kind: 'share_unwind' }) }),
      expect.anything(),
    )
    expect(f.tables.participants[0]).toMatchObject({ payer: null, individual_payment_status: null })
    expect(f.reg).toMatchObject({ share_estimate: null, share_cents: null })
  })

  it('a refund Stripe refuses is logged for a person to finish', async () => {
    const f = setup([person('s1', { individual_payment_status: 'paid', share_paid_cents: 2425, stripe_payment_intent_id: 'pi_s1' })])
    f.stripe.refunds.create.mockRejectedValueOnce(new Error('charge disputed'))
    expect(await unwindShares(f.db, f.stripe as never, 'reg-1')).toEqual({ refunded: 0, failed: 1 })
    expect(f.tables.event_refunds[0]).toMatchObject({ refund_type: 'manual_required', kind: 'share_unwind' })
  })
})

describe('a student’s checkout', () => {
  const opts = {
    participantId: 's1', participantEmail: 's1@example.com', registrationId: 'reg-1', eventSlug: 'msu',
    eventTitle: 'MSU Design Challenge', successUrl: 'https://x/ok', cancelUrl: 'https://x/back',
  }
  const group = () => [person('t', { payer: 'shared', individual_payment_status: 'covered', event_role: 'teacher' }), person('s1'), person('s2')]

  it('two lines: the place after the code, and the share untouched', async () => {
    const f = setup(group())
    const out = await createSharedSeatCheckout(f.db, f.stripe as never, { ...opts, discountCode: 'STEMCAREERS' })
    expect(out).toMatchObject({ url: 'https://checkout.stripe.test/cs_1' })
    const args = (f.stripe.checkout.sessions.create.mock.calls[0] as unknown[])[0] as { line_items: { price_data: { unit_amount: number } }[]; metadata: Row; discounts?: unknown; allow_promotion_codes?: unknown }
    expect(args.line_items.map((l) => l.price_data.unit_amount)).toEqual([8245, 2425])
    expect(args.metadata).toMatchObject({ teacherShare: 'true', baseCents: '8245', shareCents: '2425', discountCode: 'STEMCAREERS', participantId: 's1' })
    expect(args.discounts).toBeUndefined()
    expect(args.allow_promotion_codes).toBeUndefined()
  })

  it('refuses a code that isn’t valid, or is for another product', async () => {
    const f = setup(group())
    expect(await createSharedSeatCheckout(f.db, f.stripe as never, { ...opts, discountCode: 'NOPE' })).toMatchObject({ error: 'bad_code' })
    expect(await createSharedSeatCheckout(f.db, f.stripe as never, { ...opts, discountCode: 'co_other' })).toMatchObject({ error: 'bad_code', message: expect.stringMatching(/doesn’t apply/) })
    expect(f.stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('a place that comes to nothing is settled without a checkout', async () => {
    const f = setup([person('s1')], { share_unit_cents: 9700 }) // no teacher in the pool: no share
    f.stripe.coupons.retrieve.mockImplementation(async (id: string) => ({ id, valid: true, percent_off: 100, amount_off: null, applies_to: null }) as never)
    f.stripe.promotionCodes.list.mockResolvedValueOnce({ data: [{ code: 'SCHOLARSHIP100', coupon: 'co_100' }] } as never)
    const out = await createSharedSeatCheckout(f.db, f.stripe as never, { ...opts, discountCode: 'SCHOLARSHIP100' })
    expect(out).toMatchObject({ waived: true })
    expect(f.tables.participants[0]).toMatchObject({ individual_payment_status: 'waived', base_paid_cents: 0, share_paid_cents: 0 })
    expect(f.stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })
})
