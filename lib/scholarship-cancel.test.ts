import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeDb, type FakeDb } from '@/lib/refunds/fake-db.test-helper'

const { getEventBySlug, logActivity, priceRetrieve, stripeClient } = vi.hoisted(() => {
  const priceRetrieve = vi.fn(async (_id: string): Promise<{ unit_amount: number | null }> => ({ unit_amount: 16500 }))
  return {
    getEventBySlug: vi.fn(async (_slug: string): Promise<unknown> => ({ stripePriceId: 'price_fee' })),
    logActivity: vi.fn(async (_input: unknown, _db?: unknown) => {}),
    priceRetrieve,
    stripeClient: vi.fn((): unknown => ({ prices: { retrieve: priceRetrieve } })),
  }
})
vi.mock('@/lib/sanity', () => ({ getEventBySlug }))
vi.mock('@/lib/activity-log', () => ({ logActivity }))
vi.mock('@/lib/stripe', () => ({ stripeClient }))

import { cancelScholarship, cancelScholarshipsOnWithdrawal } from '@/lib/scholarship-cancel'

// ── Fixtures ──────────────────────────────────────────────────────────────────

let current: FakeDb

const ADMIN = { clerkUserId: 'user_admin', memberId: 'admin-m', name: 'Staff Admin' }

function seed(app: Record<string, unknown> = {}, reg: Record<string, unknown> | null = null) {
  current = fakeDb({
    scholarship_applications: [{
      id: 'sch-1', status: 'offered', percent_off: 50, event_slug: 'nevada', event_title: 'Nevada SDC',
      member_id: 'm1', registration_id: reg ? 'reg-1' : null, offer_token: 'a'.repeat(64), ...app,
    }],
    registrations: reg ? [{ id: 'reg-1', event_slug: 'nevada', status: 'pending', amount_due_cents: 8250, ...reg }] : [],
  })
  return current.db as never
}

const appRow = () => current.updates.filter((u) => u.table === 'scholarship_applications').at(-1)?.rows[0]
const regUpdates = () => current.updates.filter((u) => u.table === 'registrations')

beforeEach(() => {
  vi.clearAllMocks()
  priceRetrieve.mockResolvedValue({ unit_amount: 16500 })
  getEventBySlug.mockResolvedValue({ stripePriceId: 'price_fee' })
})

// ── Admin cancel ──────────────────────────────────────────────────────────────

describe('cancelScholarship — admin', () => {
  it('cancels an offer the student has not acted on yet, recording who and why', async () => {
    const r = await cancelScholarship(seed(), 'sch-1', { source: 'admin', reason: '  Moved out of state ', reviewer: ADMIN })
    expect(r.ok).toBe(true)
    expect(appRow()).toMatchObject({
      status: 'cancelled',
      cancellation_source: 'admin',
      cancellation_reason: 'Moved out of state',
      cancelled_by: 'user_admin',
      cancelled_by_name: 'Staff Admin',
    })
    expect(appRow()?.cancelled_at).toEqual(expect.any(String))
    // The offer is kept for history: its token and level stay.
    expect(appRow()).toMatchObject({ percent_off: 50, offer_token: 'a'.repeat(64) })
    expect(r.ok && r.message).toMatch(/offer link no longer works/)
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'm1', action: 'scholarship_cancelled', actorType: 'admin', actorLabel: 'Staff Admin' }),
      expect.anything(),
    )
  })

  it('puts the full fee back as the amount due on a registration still waiting for payment', async () => {
    const r = await cancelScholarship(seed({}, { status: 'pending', amount_due_cents: 8250 }), 'sch-1', { source: 'admin', reviewer: ADMIN })
    expect(r.ok && r.amountDueRestoredCents).toBe(16500)
    expect(regUpdates()).toHaveLength(1)
    expect(regUpdates()[0].patch).toEqual({ amount_due_cents: 16500 })
    expect(r.ok && r.message).toMatch(/\$165\.00 is now due/)
  })

  it('leaves the amount due alone, and says so, when the fee cannot be read from Stripe', async () => {
    priceRetrieve.mockRejectedValue(new Error('No such price'))
    const r = await cancelScholarship(seed({}, { status: 'pending' }), 'sch-1', { source: 'admin', reviewer: ADMIN })
    expect(r.ok).toBe(true)
    expect(appRow()?.status).toBe('cancelled')
    expect(regUpdates()).toHaveLength(0)
    expect(r.ok && r.message).toMatch(/couldn’t be read from Stripe/)
  })

  it('leaves a confirmed registration as it is: nothing charged, refunded or changed', async () => {
    const r = await cancelScholarship(seed({ percent_off: 100 }, { status: 'confirmed', amount_due_cents: 0 }), 'sch-1', { source: 'admin', reviewer: ADMIN })
    expect(r.ok).toBe(true)
    expect(regUpdates()).toHaveLength(0)
    expect(priceRetrieve).not.toHaveBeenCalled()
    expect(r.ok && r.message).toMatch(/stay registered/)
  })

  it('refuses anything that is not a live offer', async () => {
    for (const status of ['submitted', 'not_offered', 'cancelled']) {
      const r = await cancelScholarship(seed({ status }), 'sch-1', { source: 'admin', reviewer: ADMIN })
      expect(r).toMatchObject({ ok: false, status: 409 })
      expect(current.updates).toHaveLength(0)
    }
  })

  it('404s an unknown application', async () => {
    const r = await cancelScholarship(seed(), 'nope', { source: 'admin', reviewer: ADMIN })
    expect(r).toMatchObject({ ok: false, status: 404 })
  })
})

// ── Withdrawal ────────────────────────────────────────────────────────────────

describe('cancelScholarship — withdrawal', () => {
  it('cancels automatically with the standard reason and no admin', async () => {
    const r = await cancelScholarship(seed({}, { status: 'withdrawn' }), 'sch-1', { source: 'withdrawal' })
    expect(r.ok).toBe(true)
    expect(appRow()).toMatchObject({
      status: 'cancelled',
      cancellation_source: 'withdrawal',
      cancellation_reason: 'Withdrew from the event',
      cancelled_by: null,
      cancelled_by_name: null,
    })
    // The withdrawn registration keeps what was due on it, as history.
    expect(regUpdates()).toHaveLength(0)
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ actorType: 'system' }), expect.anything())
  })

  it('cancelScholarshipsOnWithdrawal reports what it cancelled and skips what was already ended', async () => {
    const db = seed({}, { status: 'withdrawn' })
    expect(await cancelScholarshipsOnWithdrawal(db, ['sch-1'])).toEqual([{ id: 'sch-1', percent: 50 }])
    // Second run (the same withdrawal retried): nothing left to cancel, no throw.
    expect(await cancelScholarshipsOnWithdrawal(db, ['sch-1'])).toEqual([])
  })

  it('cancelScholarshipsOnWithdrawal never throws', async () => {
    const db = { from: () => { throw new Error('db down') } } as never
    await expect(cancelScholarshipsOnWithdrawal(db, ['sch-1'])).resolves.toEqual([])
  })
})
