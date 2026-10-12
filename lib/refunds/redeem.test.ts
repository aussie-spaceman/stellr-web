import { describe, it, expect, vi, beforeEach } from 'vitest'
import type Stripe from 'stripe'

// buildCreditDiscount / finalizeRedemption, deep review PAY-9: account credit is
// RESERVED when a coupon is minted (remaining_cents decremented under a CAS), so a
// second concurrent checkout can't carry the same credit and spend it twice. These
// pin that the reservation is taken, that a second allocation can't re-spend it,
// that settlement flips the hold, and that an abandoned reservation is released.

vi.mock('server-only', () => ({}))

type Row = Record<string, unknown>
let tables: Record<string, Row[]>

// A Supabase stand-in honouring eq/in/gt/lt filters on reads AND writes — the CAS
// `update(...).eq('remaining_cents', seen)` only matches when the balance is still
// what we read, which is exactly the reservation guarantee under test.
function builder(table: string) {
  const filters: ((r: Row) => boolean)[] = []
  let pending: Row | null = null
  const matched = () => (tables[table] ??= []).filter((r) => filters.every((f) => f(r)))
  const applyUpdate = () => {
    const rows = matched()
    for (const r of rows) Object.assign(r, pending)
    return rows
  }
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
    in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
    gt: (c: string, v: number) => (filters.push((r) => (r[c] as number) > v), q),
    lt: (c: string, v: string) => (filters.push((r) => (r[c] as string) < v), q),
    or: () => q,
    order: () => q,
    maybeSingle: async () => {
      if (pending) return { data: applyUpdate()[0] ?? null, error: null }
      return { data: matched()[0] ?? null, error: null }
    },
    update: (set: Row) => ((pending = set), q),
    insert: (payload: Row | Row[]) => {
      const rows = (Array.isArray(payload) ? payload : [payload]).map((r, i) => ({ id: `${table}-${(tables[table] ??= []).length + i}`, ...r }))
      ;(tables[table] ??= []).push(...rows)
      return { then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res) }
    },
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(pending ? { data: applyUpdate(), error: null } : { data: matched(), error: null }).then(resolve, reject),
  }
  return q
}

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from: builder }) }))

import { buildCreditDiscount, finalizeRedemption } from '@/lib/refunds/redeem'

const couponCreate = vi.fn(async (p: { amount_off: number }) => ({ id: `cpn_${p.amount_off}` }))
const stripe = { coupons: { create: couponCreate } } as unknown as Stripe

const credit = () => tables.account_credits[0]
const reservations = () => tables.credit_redemptions ?? []

beforeEach(() => {
  vi.clearAllMocks()
  tables = {
    account_credits: [
      { id: 'c1', member_id: 'm1', currency: 'usd', remaining_cents: 10000, amount_cents: 10000, status: 'available', expires_at: null, created_at: '2026-01-01' },
    ],
    credit_redemptions: [],
  }
})

describe('buildCreditDiscount — reservation (PAY-9)', () => {
  it('reserves the credit: decrements the balance and records a reserved hold', async () => {
    const d = await buildCreditDiscount(stripe, 'm1', 'usd', 10000)

    expect(d).toMatchObject({ appliedCents: 10000, allocations: [{ creditId: 'c1', amount: 10000 }] })
    expect(d!.reservationId).toMatch(/^[a-f0-9]{32}$/)
    expect(couponCreate).toHaveBeenCalledWith(expect.objectContaining({ amount_off: 10000, duration: 'once' }))
    // Balance held, not left spendable.
    expect(credit().remaining_cents).toBe(0)
    expect(credit().status).toBe('redeemed')
    expect(reservations()).toHaveLength(1)
    expect(reservations()[0]).toMatchObject({ credit_id: 'c1', amount_cents: 10000, status: 'reserved' })
  })

  it('a second checkout cannot re-spend the reserved credit', async () => {
    const first = await buildCreditDiscount(stripe, 'm1', 'usd', 10000)
    const second = await buildCreditDiscount(stripe, 'm1', 'usd', 10000)

    expect(first).not.toBeNull()
    expect(second).toBeNull() // nothing left to reserve → no coupon
    expect(couponCreate).toHaveBeenCalledTimes(1)
  })

  it('reserves only the remainder when part of the credit is already held', async () => {
    await buildCreditDiscount(stripe, 'm1', 'usd', 4000) // reserve 4000 of 10000
    const d = await buildCreditDiscount(stripe, 'm1', 'usd', 10000) // only 6000 left

    expect(d).toMatchObject({ appliedCents: 6000 })
    expect(credit().remaining_cents).toBe(0)
  })
})

describe('finalizeRedemption — settlement (PAY-9)', () => {
  it('flips the reservation to settled and stamps the session, idempotently', async () => {
    const d = await buildCreditDiscount(stripe, 'm1', 'usd', 10000)
    const session = {
      id: 'cs_1',
      metadata: { creditMemberId: 'm1', creditReservationId: d!.reservationId, type: 'membership' },
    } as unknown as Stripe.Checkout.Session

    await finalizeRedemption(session)
    expect(reservations()[0]).toMatchObject({ status: 'settled', stripe_checkout_session_id: 'cs_1' })
    // Balance unchanged (already decremented at reservation time).
    expect(credit().remaining_cents).toBe(0)

    // Redelivery is a no-op (status guard) — still exactly one settled hold.
    await finalizeRedemption(session)
    expect(reservations().filter((r) => r.status === 'settled')).toHaveLength(1)
  })
})

describe('buildCreditDiscount — lapsed reservation release (PAY-9)', () => {
  it('releases an abandoned reservation back to the balance on the next checkout', async () => {
    // A hold from an earlier checkout that was never completed, now past expiry.
    tables.account_credits[0].remaining_cents = 0
    tables.account_credits[0].status = 'redeemed'
    tables.credit_redemptions = [
      { id: 'r_old', credit_id: 'c1', member_id: 'm1', amount_cents: 10000, status: 'reserved', reserved_expires_at: '2020-01-01T00:00:00Z' },
    ]

    const d = await buildCreditDiscount(stripe, 'm1', 'usd', 10000)

    // The lapsed hold was released and the freed credit reserved for this checkout.
    expect(d).toMatchObject({ appliedCents: 10000 })
    expect(reservations().find((r) => r.id === 'r_old')!.status).toBe('released')
  })
})
