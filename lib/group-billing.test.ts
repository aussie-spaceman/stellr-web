import { describe, it, expect, vi, beforeEach } from 'vitest'

// Group billing after a roster change (29 Oct 2026). A teacher asked for one
// student to come off a 19-place invoice ($97 each) and for the 15% flyer
// code to be applied. These pin the rules (removing frees a place, adding
// only grows the group once its places are full, paid groups are refunded or
// invoiced separately) and that a revision goes through Stripe's own revise
// flow with the discount carried forward.

vi.mock('server-only', () => ({}))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: async () => ({ stripePriceId: 'price_event' }) }))
vi.mock('@/lib/notify', () => ({ notifyCommunityAdmins: vi.fn(async () => {}) }))
// The quiet period is a real wait in production; tests settle the invoice by hand.
vi.mock('@/lib/after-response', () => ({ runAfterResponse: vi.fn() }))

import {
  planSeatChange,
  adjustCounts,
  invoiceTotals,
  perSeatPaidCents,
  seatBucket,
  billingMode,
  describeRemoval,
  applyRosterChange,
  setGroupDiscount,
  reissueGroupInvoice,
  invoiceNeedsCorrection,
  openAdditionalInvoiceFor,
  recordGroupInvoicePaid,
  syncGroupInvoice,
  syncDueGroupInvoices,
} from './group-billing'
import { runAfterResponse } from '@/lib/after-response'
import { notifyCommunityAdmins } from '@/lib/notify'

// ── Pure rules ───────────────────────────────────────────────────────────────

describe('planSeatChange', () => {
  const base = { mode: 'invoice' as const, seatsBefore: 19, rosterAfter: 18, invoice: 'open' as const, cardPaid: false }

  it('revises an unpaid invoice down by one place when a participant is removed', () => {
    expect(planSeatChange({ ...base, change: { kind: 'removed' } })).toEqual({ seatsAfter: 18, invoice: 'revise', additionalSeats: 0 })
  })

  it('voids the invoice when the last participant goes', () => {
    expect(planSeatChange({ ...base, seatsBefore: 1, rosterAfter: 0, change: { kind: 'removed' } }))
      .toEqual({ seatsAfter: 0, invoice: 'void', additionalSeats: 0 })
  })

  it('leaves a paid invoice alone on removal (the caller refunds the place)', () => {
    expect(planSeatChange({ ...base, invoice: 'paid', change: { kind: 'removed' } }))
      .toEqual({ seatsAfter: 18, invoice: 'none', additionalSeats: 0 })
  })

  it('frees the place even when the roster had empty places (join-link group)', () => {
    expect(planSeatChange({ ...base, seatsBefore: 10, rosterAfter: 2, change: { kind: 'removed' } }))
      .toEqual({ seatsAfter: 9, invoice: 'revise', additionalSeats: 0 })
  })

  it('changes nothing when an added person fills a place already paid for', () => {
    expect(planSeatChange({ ...base, seatsBefore: 10, rosterAfter: 4, change: { kind: 'added', count: 1 } }))
      .toEqual({ seatsAfter: 10, invoice: 'none', additionalSeats: 0 })
  })

  it('revises an unpaid invoice up when the group outgrows its places', () => {
    expect(planSeatChange({ ...base, seatsBefore: 18, rosterAfter: 19, change: { kind: 'added', count: 1 } }))
      .toEqual({ seatsAfter: 19, invoice: 'revise', additionalSeats: 0 })
  })

  it('raises an additional invoice for places added after the invoice was paid', () => {
    expect(planSeatChange({ ...base, invoice: 'paid', seatsBefore: 18, rosterAfter: 20, change: { kind: 'added', count: 2 } }))
      .toEqual({ seatsAfter: 20, invoice: 'additional', additionalSeats: 2 })
  })

  it('raises an additional invoice for a card group only once it has paid', () => {
    const card = { ...base, mode: 'card' as const, invoice: 'none' as const, seatsBefore: 5, rosterAfter: 6, change: { kind: 'added' as const, count: 1 } }
    expect(planSeatChange({ ...card, cardPaid: true }).invoice).toBe('additional')
    expect(planSeatChange({ ...card, cardPaid: false })).toEqual({ seatsAfter: 6, invoice: 'none', additionalSeats: 0 })
  })

  it('never bills a members-pay-individually or free group, but still tracks places', () => {
    expect(planSeatChange({ ...base, mode: 'individual', change: { kind: 'removed' } })).toEqual({ seatsAfter: 18, invoice: 'none', additionalSeats: 0 })
    expect(planSeatChange({ ...base, mode: 'free', seatsBefore: 3, rosterAfter: 4, change: { kind: 'added', count: 1 } }).invoice).toBe('none')
  })
})

describe('the small rules', () => {
  it('counts a student-manager as a student and everyone else non-participant as an adult', () => {
    expect(seatBucket('participant')).toBe('student')
    expect(seatBucket('school_student_manager')).toBe('student')
    expect(seatBucket('teacher')).toBe('adult')
  })

  it('takes places from the person’s own bucket first, then the other', () => {
    expect(adjustCounts({ adult: 1, student: 18 }, 'student', -1)).toEqual({ adult: 1, student: 17 })
    expect(adjustCounts({ adult: 2, student: 0 }, 'student', -1)).toEqual({ adult: 1, student: 0 })
    expect(adjustCounts({ adult: 1, student: 17 }, 'adult', 2)).toEqual({ adult: 3, student: 17 })
  })

  it('works out the teacher’s revised invoice: 18 × $97 less 15% = $1,484.10', () => {
    expect(invoiceTotals(18, 9700, { percentOff: 15, amountOffCents: null }))
      .toEqual({ subtotalCents: 174_600, discountCents: 26_190, totalCents: 148_410 })
    expect(invoiceTotals(2, 9700, { percentOff: null, amountOffCents: 2800 }).totalCents).toBe(16_600)
  })

  it('refunds what one place actually cost on a discounted invoice, never the list price', () => {
    expect(perSeatPaidCents(148_410, 18)).toBe(8245)
    expect(perSeatPaidCents(0, 18)).toBeNull()
    expect(perSeatPaidCents(1000, 0)).toBeNull()
  })

  it('reads how a group pays', () => {
    const reg = { type: 'group', status: 'pending', member_pays_individually: false, invoice_requested: false, stripe_payment_intent_id: null, amount_due_cents: 9700 }
    expect(billingMode({ ...reg, invoice_requested: true })).toBe('invoice')
    expect(billingMode({ ...reg, member_pays_individually: true })).toBe('individual')
    expect(billingMode(reg)).toBe('card')
    expect(billingMode({ ...reg, amount_due_cents: 0 })).toBe('free')
    expect(billingMode({ ...reg, type: 'campaign' })).toBe('free')
  })

  it('tells the organiser about the refund before the invoice', () => {
    expect(describeRemoval({ type: 'cash', refundCents: 8245, detail: 'Refunded' }, null)).toMatch(/\$82\.45 refund/)
    expect(describeRemoval({ type: 'none', refundCents: 0, detail: 'Paid 60 days ago — outside the 45-day money-back guarantee, so no refund was issued' }, null))
      .toMatch(/outside our money-back guarantee/)
    expect(describeRemoval({ type: 'none', refundCents: 0, detail: 'Unpaid — nothing to refund' }, { message: 'Updated.', action: 'revised', seatsAfter: 18 }))
      .toBe('Updated.')
  })
})

// ── Orchestration against a fake database and Stripe ─────────────────────────

type Row = Record<string, unknown>

function fakeDb(tables: Record<string, Row[]>) {
  const writes: { table: string; op: string; values: Row; filters: [string, unknown][] }[] = []
  function builder(table: string) {
    const filters: [string, string, unknown][] = []
    let op: 'select' | 'update' | 'upsert' = 'select'
    let values: Row = {}
    let countMode = false
    const orMatch = (r: Row, expr: string) => expr.split(',').some((part) => {
      const [col, op, ...rest] = part.split('.')
      return op === 'is' ? (r[col] ?? null) === null : op === 'lt' ? (r[col] as string) < rest.join('.') : false
    })
    const match = (r: Row) => filters.every(([kind, col, val]) =>
      kind === 'eq' ? r[col] === val
        : kind === 'in' ? (val as unknown[]).includes(r[col])
          : kind === 'is' ? (r[col] ?? null) === val
            : kind === 'not_null' ? (r[col] ?? null) !== null
              : kind === 'lte' ? (r[col] as string) <= (val as string)
                : kind === 'or' ? orMatch(r, val as string)
                  : true)
    const run = () => {
      const rows = (tables[table] ??= [])
      if (op === 'update') {
        const matched = rows.filter(match)
        matched.forEach((r) => Object.assign(r, values))
        writes.push({ table, op, values, filters: filters.map(([, c, v]) => [c, v]) })
        return { data: matched, error: null }
      }
      if (op === 'upsert') {
        const existing = rows.find((r) => r.stripe_invoice_id === values.stripe_invoice_id)
        if (existing) Object.assign(existing, values)
        else rows.push({ id: `${table}-${rows.length}`, participant_ids: [], created_at: new Date(Date.now() + rows.length).toISOString(), ...values })
        writes.push({ table, op, values, filters: [] })
        return { data: null, error: null }
      }
      const out = rows.filter(match)
      return countMode ? { data: null, count: out.length, error: null } : { data: out, error: null }
    }
    const q: Record<string, unknown> = {
      select: (_c?: string, opts?: { count?: string }) => { countMode = !!opts?.count; return q },
      eq: (c: string, v: unknown) => (filters.push(['eq', c, v]), q),
      in: (c: string, v: unknown[]) => (filters.push(['in', c, v]), q),
      is: (c: string, v: unknown) => (filters.push(['is', c, v]), q),
      not: (c: string) => (filters.push(['not_null', c, null]), q),
      lte: (c: string, v: unknown) => (filters.push(['lte', c, v]), q),
      or: (expr: string) => (filters.push(['or', '', expr]), q),
      order: () => q,
      limit: () => q,
      update: (v: Row) => { op = 'update'; values = v; return q },
      upsert: (v: Row) => { op = 'upsert'; values = v; return q },
      maybeSingle: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: null } },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    }
    return q
  }
  return { db: { from: builder } as never, tables, writes }
}

const REG = {
  id: 'reg-1', type: 'group', event_slug: 'mn-edc', event_title: 'Minnesota EDC', status: 'pending',
  invoice_requested: true, invoice_paid_at: null, member_pays_individually: false, stripe_payment_intent_id: null,
  amount_due_cents: 184_300, adult_count: 1, student_count: 18, teacher_first_name: 'T', teacher_last_name: 'Teacher',
  teacher_email: 'teacher@example.com', teacher_member_id: 'm-teacher', invoice_coupon_id: null, invoice_promotion_code: null,
}

/** The quiet period has passed: run the update the roster change left due. */
async function settle(f: { db: never; tables: Record<string, Row[]> }, stripe: unknown) {
  f.tables.registrations[0].invoice_sync_due_at = new Date(Date.now() - 1000).toISOString()
  return syncGroupInvoice(f.db, stripe as never, 'reg-1')
}

const roster = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, registration_id: 'reg-1' }))

function openInvoice(id: string, extra: Row = {}) {
  return { id, number: 'INV-0001', status: 'open', customer: 'cus_1', currency: 'usd', subtotal: 184_300, total: 184_300, total_discount_amounts: [], metadata: { registrationId: 'reg-1' }, latest_revision: null, ...extra }
}

function fakeStripe() {
  const invoices = new Map<string, Row>([['in_orig', openInvoice('in_orig')]])
  return {
    invoices,
    prices: { retrieve: vi.fn(async () => ({ unit_amount: 9700, currency: 'usd' })) },
    coupons: { retrieve: vi.fn(async (id: string) => ({ id, valid: true, percent_off: 15, amount_off: null, name: '2027 2pp Flyer Discount' })) },
    promotionCodes: { list: vi.fn(async () => ({ data: [{ code: 'STEMCAREERS', promotion: { coupon: 'coupon_15' } }] })) },
    customers: { create: vi.fn() },
    invoiceItems: { create: vi.fn(async () => ({ id: 'ii_new' })) },
  }
}

describe('applyRosterChange — removing a participant from an invoiced group', () => {
  let stripe: ReturnType<typeof buildStripe>
  function buildStripe() {
    const store = new Map<string, Row>([['in_orig', openInvoice('in_orig')]])
    const base = fakeStripe()
    return {
      ...base,
      store,
      invoices: {
        search: vi.fn(async () => ({ data: [...store.values()] })),
        retrieve: vi.fn(async (id: string) => store.get(id)),
        list: vi.fn(async (): Promise<{ data: Row[] }> => ({ data: [] })),
        create: vi.fn(async (): Promise<Row> => {
          const draft = { ...openInvoice('in_rev'), status: 'draft', number: null, lines: { data: [{ id: 'il_old' }] } }
          store.set('in_rev', draft)
          return draft
        }),
        removeLines: vi.fn(async () => ({})),
        update: vi.fn(async () => ({})),
        finalizeInvoice: vi.fn(async (id: string) => {
          const inv = store.get(id)!
          Object.assign(inv, { status: 'open', number: 'INV-0001-1', subtotal: 174_600, total: 148_410, total_discount_amounts: [{ amount: 26_190 }] })
          Object.assign(store.get('in_orig')!, { status: 'void', latest_revision: 'in_rev' })
          return inv
        }),
        sendInvoice: vi.fn(async (id: string) => store.get(id)),
        voidInvoice: vi.fn(async (id: string) => Object.assign(store.get(id)!, { status: 'void' })),
      },
    }
  }

  beforeEach(() => {
    stripe = buildStripe()
  })

  it('waits, then revises the open invoice to 18 places with the discount, and drops one student place', async () => {
    const f = fakeDb({ registrations: [{ ...REG, invoice_coupon_id: 'coupon_15', invoice_promotion_code: 'STEMCAREERS' }], participants: roster(18), group_invoices: [] })

    const out = await applyRosterChange(f.db, stripe as never, {
      registrationId: 'reg-1', change: { kind: 'removed' }, eventRole: 'participant', actor: { memberId: 'm-teacher', label: 'organiser' },
    })

    // Nothing goes to Stripe or the organiser yet; they're told what's coming.
    expect(out).toMatchObject({ action: 'scheduled', seatsAfter: 18 })
    expect(out.message).toMatch(/updated invoice for 18 participants in a couple of minutes/)
    expect(stripe.invoices.create).not.toHaveBeenCalled()
    expect(f.tables.registrations[0].invoice_sync_due_at).toEqual(expect.any(String))
    expect(runAfterResponse).toHaveBeenCalled()

    await expect(settle(f, stripe)).resolves.toBe('revised')
    expect(f.tables.registrations[0].invoice_sync_due_at).toBeNull()
    expect(f.tables.registrations[0].invoice_sync_lock_until).toBeNull()
    // Stripe's own revision of the original, never a second unrelated invoice.
    expect(stripe.invoices.create).toHaveBeenCalledWith({ from_invoice: { action: 'revision', invoice: 'in_orig' } })
    expect(stripe.invoices.removeLines).toHaveBeenCalledWith('in_rev', { lines: [{ id: 'il_old', behavior: 'delete' }] })
    expect(stripe.invoiceItems.create).toHaveBeenCalledWith(expect.objectContaining({ invoice: 'in_rev', quantity: 18 }))
    expect(stripe.invoices.update).toHaveBeenCalledWith('in_rev', expect.objectContaining({ discounts: [{ coupon: 'coupon_15' }] }))
    expect(stripe.invoices.sendInvoice).toHaveBeenCalledWith('in_rev')
    // One fewer student place; the amount due follows at the price locked in.
    expect(f.tables.registrations[0]).toMatchObject({ adult_count: 1, student_count: 17, amount_due_cents: 18 * 9700 })
    // The ledger knows both invoices and why the new one exists.
    const ledger = f.tables.group_invoices
    expect(ledger.find((r) => r.stripe_invoice_id === 'in_orig')).toMatchObject({ status: 'void' })
    expect(ledger.find((r) => r.stripe_invoice_id === 'in_rev')).toMatchObject({
      status: 'open', seats: 18, per_seat_cents: 9700, total_cents: 148_410, replaces_stripe_invoice_id: 'in_orig',
      reason: 'Updated to 18 participants (was 19)',
    })
  })

  it('reuses a draft revision someone started in the Dashboard (Stripe allows only one)', async () => {
    const f = fakeDb({ registrations: [{ ...REG }], participants: roster(18), group_invoices: [] })
    stripe.invoices.create.mockRejectedValueOnce(new Error('This invoice already has a draft revision'))
    const dashboardDraft = { ...openInvoice('in_rev'), status: 'draft', from_invoice: { action: 'revision', invoice: 'in_orig' }, lines: { data: [{ id: 'il_copy' }] } }
    stripe.store.set('in_rev', dashboardDraft)
    stripe.invoices.list.mockResolvedValueOnce({ data: [dashboardDraft] })

    await applyRosterChange(f.db, stripe as never, {
      registrationId: 'reg-1', change: { kind: 'removed' }, eventRole: 'participant', actor: { memberId: null, label: 'admin' },
    })

    await expect(settle(f, stripe)).resolves.toBe('revised')
    expect(stripe.invoices.removeLines).toHaveBeenCalledWith('in_rev', { lines: [{ id: 'il_copy', behavior: 'delete' }] })
  })

  it('voids the invoice when the last participant is removed', async () => {
    const f = fakeDb({ registrations: [{ ...REG, adult_count: 0, student_count: 1 }], participants: [], group_invoices: [] })

    const out = await applyRosterChange(f.db, stripe as never, {
      registrationId: 'reg-1', change: { kind: 'removed' }, eventRole: 'participant', actor: { memberId: null, label: 'admin' },
    })

    expect(out).toMatchObject({ action: 'scheduled', seatsAfter: 0 })
    await expect(settle(f, stripe)).resolves.toBe('voided')
    expect(stripe.invoices.voidInvoice).toHaveBeenCalledWith('in_orig')
    expect(stripe.invoices.create).not.toHaveBeenCalled()
  })

  it('alerts staff, keeps the roster change and stays due when Stripe refuses', async () => {
    const f = fakeDb({ registrations: [{ ...REG }], participants: roster(18), group_invoices: [] })
    stripe.invoices.create.mockRejectedValueOnce(new Error('Stripe is down'))
    stripe.invoices.list.mockResolvedValueOnce({ data: [] })

    const out = await applyRosterChange(f.db, stripe as never, {
      registrationId: 'reg-1', change: { kind: 'removed' }, eventRole: 'participant', actor: { memberId: null, label: 'admin' },
    })

    expect(out.action).toBe('scheduled')
    await expect(settle(f, stripe)).resolves.toBe('failed')
    expect(notifyCommunityAdmins).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringMatching(/Send corrected invoice/) }))
    expect(f.tables.registrations[0]).toMatchObject({ student_count: 17 })
    // Still due, so the daily cron tries again; the lock is free for it.
    expect(f.tables.registrations[0].invoice_sync_due_at).toEqual(expect.any(String))
    expect(f.tables.registrations[0].invoice_sync_lock_until).toBeNull()
  })

  it('invoices an added participant separately once the group has paid', async () => {
    stripe.store.set('in_orig', { ...openInvoice('in_orig'), status: 'paid' })
    stripe.invoices.create.mockImplementationOnce(async () => {
      const draft = { ...openInvoice('in_add'), status: 'draft', number: null }
      stripe.store.set('in_add', draft)
      return draft
    })
    stripe.invoices.finalizeInvoice.mockImplementationOnce(async (id: string) => Object.assign(stripe.store.get(id)!, { status: 'open', total: 8245, subtotal: 9700 }))
    const f = fakeDb({
      registrations: [{ ...REG, invoice_paid_at: '2026-11-01T00:00:00Z', invoice_coupon_id: 'coupon_15' }],
      participants: roster(20),
      group_invoices: [],
    })

    const out = await applyRosterChange(f.db, stripe as never, {
      registrationId: 'reg-1', change: { kind: 'added', count: 1 }, eventRole: 'participant', participantIds: ['p19'], actor: { memberId: 'm-teacher', label: 'organiser' },
    })

    expect(out).toMatchObject({ action: 'additional', seatsAfter: 20 })
    expect(stripe.invoices.create).toHaveBeenCalledWith(expect.objectContaining({
      discounts: [{ coupon: 'coupon_15' }],
      metadata: expect.objectContaining({ kind: 'additional', seats: '1', participantIds: 'p19' }),
    }))
    expect(stripe.invoiceItems.create).toHaveBeenCalledWith(expect.objectContaining({ invoice: 'in_add', quantity: 1 }))
  })
})

// 5 Nov 2026: the Minnesota group's chain reached Stripe's cap of 4 invoices, and
// every later roster change failed, with the invoice stuck at 17 places while the
// group had 15. A group must be able to change any number of times.
describe('any number of roster changes on an unpaid invoice', () => {
  // A plain object carrying Stripe's `type`, on purpose: a real refusal failed
  // `instanceof StripeInvalidRequestError` in the test-mode drill.
  const REFUSED = Object.assign(
    new Error('You cannot have more than 4 in a revision history, including the original invoice.'),
    { type: 'StripeInvalidRequestError' },
  )

  /** A Stripe that allows `cap` invoices per revision chain, as the real one does. */
  function stripeWithCap(cap = 4) {
    let next = 1
    const store = new Map<string, Row>()
    const chain = new Map<string, number>()
    const items = new Map<string, number>()
    store.set('in_0', openInvoice('in_0', { due_date: 4_000_000_000, number: 'INV-0' }))
    chain.set('in_0', 1)
    const stripe = {
      ...fakeStripe(),
      store,
      items,
      invoiceItems: { create: vi.fn(async (p: Row) => { items.set(p.invoice as string, p.quantity as number); return { id: 'ii' } }) },
      invoices: {
        search: vi.fn(async () => ({ data: [...store.values()] })),
        list: vi.fn(async () => ({ data: [] as Row[] })),
        retrieve: vi.fn(async (id: string) => store.get(id)),
        create: vi.fn(async (p: { from_invoice?: { invoice: string } } & Row) => {
          const id = `in_${next++}`
          const from = p.from_invoice?.invoice
          if (from && (chain.get(from) ?? 1) >= cap) throw REFUSED
          chain.set(id, from ? (chain.get(from) ?? 1) + 1 : 1)
          const inv = { ...openInvoice(id), status: 'draft', number: null, from: from ?? null, lines: { data: [] }, metadata: p.metadata ?? {}, create_params: p }
          store.set(id, inv)
          return inv
        }),
        removeLines: vi.fn(async () => ({})),
        update: vi.fn(async () => ({})),
        finalizeInvoice: vi.fn(async (id: string) => {
          const inv = store.get(id)!
          Object.assign(inv, { status: 'open', number: `INV-${id}`, total: (items.get(id) ?? 0) * 9700 })
          if (inv.from) Object.assign(store.get(inv.from as string)!, { status: 'void', latest_revision: id })
          return inv
        }),
        sendInvoice: vi.fn(async (id: string) => store.get(id)),
        voidInvoice: vi.fn(async (id: string) => Object.assign(store.get(id)!, { status: 'void' })),
      },
    }
    return stripe
  }

  it('keeps going through 12 changes, always leaving one open invoice at the right size', async () => {
    const stripe = stripeWithCap()
    const f = fakeDb({ registrations: [{ ...REG, adult_count: 1, student_count: 18 }], participants: roster(19), group_invoices: [] })

    for (let i = 0; i < 12; i++) {
      f.tables.participants.pop()
      const out = await applyRosterChange(f.db, stripe as never, {
        registrationId: 'reg-1', change: { kind: 'removed' }, eventRole: 'participant', actor: { memberId: null, label: 'organiser' },
      })
      expect(out).toMatchObject({ action: 'scheduled', seatsAfter: 18 - i })
      await expect(settle(f, stripe)).resolves.toBe('revised')
      const open = [...stripe.store.values()].filter((inv) => inv.status === 'open')
      expect(open).toHaveLength(1)
      expect(stripe.items.get(open[0].id as string)).toBe(18 - i)
    }
    // Revisions where Stripe allows them, and a new chain once it stops.
    const first = stripe.invoices.create.mock.calls.filter(([p]) => !p.from_invoice)
    expect(first.length).toBeGreaterThanOrEqual(3)
    expect(stripe.invoices.sendInvoice).toHaveBeenCalledTimes(12)
  })

  it('replaces the invoice at the cap: same customer, discount and due date, sent only after the old one is void', async () => {
    const stripe = stripeWithCap(1)
    const f = fakeDb({
      registrations: [{ ...REG, invoice_coupon_id: 'coupon_15', invoice_promotion_code: 'STEMCAREERS' }],
      participants: roster(18),
      group_invoices: [],
    })
    const order: string[] = []
    stripe.invoices.voidInvoice.mockImplementationOnce(async (id: string) => {
      order.push(`void:${id}`)
      return Object.assign(stripe.store.get(id)!, { status: 'void' })
    })
    stripe.invoices.sendInvoice.mockImplementationOnce(async (id: string) => {
      order.push(`send:${id}`)
      return stripe.store.get(id)
    })

    await applyRosterChange(f.db, stripe as never, {
      registrationId: 'reg-1', change: { kind: 'removed' }, eventRole: 'participant', actor: { memberId: 'm-teacher', label: 'organiser' },
    })

    await expect(settle(f, stripe)).resolves.toBe('revised')
    expect(order).toEqual(['void:in_0', 'send:in_2'])
    expect(stripe.invoices.create).toHaveBeenLastCalledWith(expect.objectContaining({
      customer: 'cus_1',
      collection_method: 'send_invoice',
      due_date: 4_000_000_000,
      discounts: [{ coupon: 'coupon_15' }],
      metadata: expect.objectContaining({ registrationId: 'reg-1', isGroup: 'true', kind: 'seats', seats: '18', replaces: 'in_0' }),
    }))
    const ledger = f.tables.group_invoices
    expect(ledger.find((r) => r.stripe_invoice_id === 'in_0')).toMatchObject({ status: 'void' })
    expect(ledger.find((r) => r.stripe_invoice_id === 'in_2')).toMatchObject({ status: 'open', seats: 18, replaces_stripe_invoice_id: 'in_0' })
  })

  it('does not leave two payable invoices if the old one was just paid', async () => {
    const stripe = stripeWithCap(1)
    const f = fakeDb({ registrations: [{ ...REG }], participants: roster(18), group_invoices: [] })
    stripe.invoices.voidInvoice.mockImplementationOnce(async () => { throw new Error('This invoice has been paid.') })

    await applyRosterChange(f.db, stripe as never, {
      registrationId: 'reg-1', change: { kind: 'removed' }, eventRole: 'participant', actor: { memberId: null, label: 'admin' },
    })

    await expect(settle(f, stripe)).resolves.toBe('failed')
    expect(stripe.store.get('in_2')).toMatchObject({ status: 'void' })
    expect(stripe.invoices.sendInvoice).not.toHaveBeenCalled()
  })

  it('still reports failure, not a replacement, when Stripe is unreachable', async () => {
    const stripe = stripeWithCap()
    stripe.invoices.create.mockRejectedValueOnce(new Error('Connection error'))
    const f = fakeDb({ registrations: [{ ...REG }], participants: roster(18), group_invoices: [] })

    await applyRosterChange(f.db, stripe as never, {
      registrationId: 'reg-1', change: { kind: 'removed' }, eventRole: 'participant', actor: { memberId: null, label: 'admin' },
    })

    await expect(settle(f, stripe)).resolves.toBe('failed')
    expect(stripe.store.get('in_0')).toMatchObject({ status: 'open' })
  })

  it('applies a discount past the cap too', async () => {
    const stripe = stripeWithCap(1)
    const f = fakeDb({ registrations: [{ ...REG }], participants: roster(19), group_invoices: [] })

    const res = await setGroupDiscount(f.db, stripe as never, 'reg-1', { couponId: 'coupon_15', code: 'STEMCAREERS', label: 'STEMCAREERS (15% off)', terms: { percentOff: 15, amountOffCents: null } }, { memberId: null, label: 'admin' })

    expect(res).toMatchObject({ ok: true, invoiceId: 'in_2' })
    expect(stripe.store.get('in_0')).toMatchObject({ status: 'void' })
  })

  it('finds a replacement invoice when its ledger write was lost', async () => {
    const stripe = stripeWithCap()
    Object.assign(stripe.store.get('in_0')!, { status: 'void' })
    stripe.store.set('in_9', openInvoice('in_9', { metadata: { registrationId: 'reg-1', kind: 'seats', seats: '18' } }))
    const f = fakeDb({
      registrations: [{ ...REG, adult_count: 0, student_count: 18 }],
      participants: roster(18),
      group_invoices: [{ id: 'gi-0', registration_id: 'reg-1', stripe_invoice_id: 'in_0', kind: 'seats', status: 'void', seats: 19, per_seat_cents: 9700, created_at: '2026-10-29' }],
    })

    const res = await reissueGroupInvoice(f.db, stripe as never, 'reg-1', { memberId: null, label: 'admin' })

    expect(res).toMatchObject({ ok: true })
    expect(stripe.invoices.create).toHaveBeenCalledWith({ from_invoice: { action: 'revision', invoice: 'in_9' } })
  })

  describe('reissueGroupInvoice', () => {
    it('corrects an invoice that fell behind the group, keeping the discount', async () => {
      const stripe = stripeWithCap(1)
      const f = fakeDb({
        registrations: [{ ...REG, adult_count: 1, student_count: 14, invoice_coupon_id: 'coupon_15' }],
        participants: roster(15),
        group_invoices: [{ id: 'gi-0', registration_id: 'reg-1', stripe_invoice_id: 'in_0', kind: 'seats', status: 'open', seats: 17, per_seat_cents: 9700, created_at: '2026-11-05' }],
      })

      const res = await reissueGroupInvoice(f.db, stripe as never, 'reg-1', { memberId: 'm-admin', label: 'admin' })

      expect(res).toMatchObject({ ok: true, invoiceId: 'in_2' })
      expect(stripe.items.get('in_2')).toBe(15)
      expect(stripe.invoices.create).toHaveBeenLastCalledWith(expect.objectContaining({ discounts: [{ coupon: 'coupon_15' }] }))
    })

    it('issues a new invoice when the last one was voided', async () => {
      const stripe = stripeWithCap()
      Object.assign(stripe.store.get('in_0')!, { status: 'void' })
      const f = fakeDb({
        registrations: [{ ...REG, adult_count: 1, student_count: 2 }],
        participants: roster(3),
        group_invoices: [{ id: 'gi-0', registration_id: 'reg-1', stripe_invoice_id: 'in_0', kind: 'seats', status: 'void', seats: 5, per_seat_cents: 9700, created_at: '2026-11-05' }],
      })

      const res = await reissueGroupInvoice(f.db, stripe as never, 'reg-1', { memberId: null, label: 'admin' })

      expect(res).toMatchObject({ ok: true })
      expect(stripe.items.get((res as { invoiceId: string }).invoiceId)).toBe(3)
    })

    it('refuses a paid invoice', async () => {
      const f = fakeDb({ registrations: [{ ...REG, invoice_paid_at: '2026-11-01T00:00:00Z' }], participants: roster(19), group_invoices: [] })
      const res = await reissueGroupInvoice(f.db, {} as never, 'reg-1', { memberId: null, label: 'admin' })
      expect(res).toMatchObject({ ok: false })
    })
  })

  describe('a burst of changes', () => {
    const remove = (f: { db: never; tables: Record<string, Row[]> }, stripe: unknown) => {
      f.tables.participants.pop()
      return applyRosterChange(f.db, stripe as never, {
        registrationId: 'reg-1', change: { kind: 'removed' }, eventRole: 'participant', actor: { memberId: null, label: 'organiser' },
      })
    }
    const add = (f: { db: never; tables: Record<string, Row[]> }, stripe: unknown) => {
      f.tables.participants.push({ id: `new${f.tables.participants.length}`, registration_id: 'reg-1' })
      return applyRosterChange(f.db, stripe as never, {
        registrationId: 'reg-1', change: { kind: 'added', count: 1 }, eventRole: 'participant', actor: { memberId: null, label: 'organiser' },
      })
    }

    it('sends one invoice, at the final size', async () => {
      const stripe = stripeWithCap()
      const f = fakeDb({ registrations: [{ ...REG }], participants: roster(19), group_invoices: [] })

      await remove(f, stripe)
      await remove(f, stripe)
      await remove(f, stripe)
      await expect(settle(f, stripe)).resolves.toBe('revised')

      expect(stripe.invoices.sendInvoice).toHaveBeenCalledTimes(1)
      const open = [...stripe.store.values()].filter((inv) => inv.status === 'open')
      expect(open).toHaveLength(1)
      expect(stripe.items.get(open[0].id as string)).toBe(16)
    })

    it('sends nothing when the changes cancel out', async () => {
      const stripe = stripeWithCap()
      const f = fakeDb({ registrations: [{ ...REG }], participants: roster(19), group_invoices: [] })

      await remove(f, stripe)
      await add(f, stripe)
      await expect(settle(f, stripe)).resolves.toBe('none')

      expect(stripe.invoices.create).not.toHaveBeenCalled()
      expect(stripe.invoices.sendInvoice).not.toHaveBeenCalled()
      expect(f.tables.registrations[0].invoice_sync_due_at).toBeNull()
    })

    it('leaves an earlier change\'s wake-up with nothing to do while the quiet period runs', async () => {
      const stripe = stripeWithCap()
      const f = fakeDb({ registrations: [{ ...REG }], participants: roster(19), group_invoices: [] })

      await remove(f, stripe)

      await expect(syncGroupInvoice(f.db, stripe as never, 'reg-1')).resolves.toBe('not_due')
      expect(stripe.invoices.create).not.toHaveBeenCalled()
    })

    it('stays due when a change arrives during the update', async () => {
      const stripe = stripeWithCap()
      const f = fakeDb({ registrations: [{ ...REG }], participants: roster(19), group_invoices: [] })
      await remove(f, stripe)
      const later = new Date(Date.now() + 120_000).toISOString()
      stripe.invoices.update.mockImplementationOnce(async () => {
        f.tables.registrations[0].invoice_sync_due_at = later
        return {}
      })

      await expect(settle(f, stripe)).resolves.toBe('revised')

      expect(f.tables.registrations[0].invoice_sync_due_at).toBe(later)
    })
  })

  describe('changes at the same moment', () => {
    const removal = (f: { db: never }, stripe: unknown) => applyRosterChange(f.db, stripe as never, {
      registrationId: 'reg-1', change: { kind: 'removed' }, eventRole: 'participant', actor: { memberId: null, label: 'organiser' },
    })

    it('frees both places when two removals race', async () => {
      const stripe = stripeWithCap()
      const f = fakeDb({ registrations: [{ ...REG }], participants: roster(17), group_invoices: [] })

      const [a, b] = await Promise.all([removal(f, stripe), removal(f, stripe)])

      expect(f.tables.registrations[0].student_count).toBe(16)
      expect([a.seatsAfter, b.seatsAfter].sort()).toEqual([17, 18])
    })

    it('frees every place in a larger race', async () => {
      const stripe = stripeWithCap()
      const f = fakeDb({ registrations: [{ ...REG }], participants: roster(15), group_invoices: [] })

      await Promise.all([removal(f, stripe), removal(f, stripe), removal(f, stripe), removal(f, stripe)])

      expect((f.tables.registrations[0].adult_count as number) + (f.tables.registrations[0].student_count as number)).toBe(15)
    })

    it('lets only one update touch the invoice', async () => {
      const stripe = stripeWithCap()
      const f = fakeDb({ registrations: [{ ...REG }], participants: roster(18), group_invoices: [] })
      await removal(f, stripe)
      f.tables.registrations[0].invoice_sync_due_at = new Date(Date.now() - 1000).toISOString()

      const results = await Promise.all([
        syncGroupInvoice(f.db, stripe as never, 'reg-1'),
        syncGroupInvoice(f.db, stripe as never, 'reg-1'),
      ])

      expect(results.sort()).toEqual(['busy', 'revised'])
      expect(stripe.invoices.sendInvoice).toHaveBeenCalledTimes(1)
    })

    it('makes an admin wait for a lock in use, and takes one that has expired', async () => {
      const stripe = stripeWithCap()
      const row = { ...REG, adult_count: 0, student_count: 5 }
      const ledger = [{ id: 'gi-0', registration_id: 'reg-1', stripe_invoice_id: 'in_0', kind: 'seats', status: 'open', seats: 7, per_seat_cents: 9700, created_at: '2026-11-05' }]
      const held = fakeDb({ registrations: [{ ...row, invoice_sync_lock_until: new Date(Date.now() + 60_000).toISOString() }], participants: roster(5), group_invoices: ledger })

      await expect(reissueGroupInvoice(held.db, stripe as never, 'reg-1', { memberId: null, label: 'admin' }))
        .resolves.toMatchObject({ ok: false, error: expect.stringMatching(/being updated/) })
      expect(stripe.invoices.create).not.toHaveBeenCalled()

      const expired = fakeDb({ registrations: [{ ...row, invoice_sync_lock_until: new Date(Date.now() - 60_000).toISOString() }], participants: roster(5), group_invoices: ledger })
      await expect(reissueGroupInvoice(expired.db, stripe as never, 'reg-1', { memberId: null, label: 'admin' }))
        .resolves.toMatchObject({ ok: true })
    })

    it('an admin correction leaves the pending update nothing to do', async () => {
      const stripe = stripeWithCap()
      const f = fakeDb({ registrations: [{ ...REG }], participants: roster(18), group_invoices: [] })
      await removal(f, stripe)

      await expect(reissueGroupInvoice(f.db, stripe as never, 'reg-1', { memberId: null, label: 'admin' })).resolves.toMatchObject({ ok: true })

      expect(f.tables.registrations[0].invoice_sync_due_at).toBeNull()
    })
  })

  describe('the older invoice is paid during the quiet period', () => {
    const paidLedger = [{ id: 'gi-0', registration_id: 'reg-1', stripe_invoice_id: 'in_0', kind: 'seats', status: 'paid', seats: 19, per_seat_cents: 9700, created_at: '2026-11-05' }]
    const paid = (stripe: ReturnType<typeof stripeWithCap>) => Object.assign(stripe.store.get('in_0')!, { status: 'paid', amount_paid: 184_300 })

    it('invoices the extra places separately', async () => {
      const stripe = stripeWithCap()
      paid(stripe)
      const f = fakeDb({ registrations: [{ ...REG, adult_count: 1, student_count: 20 }], participants: roster(21), group_invoices: paidLedger.map((r) => ({ ...r })) })

      await expect(settle(f, stripe)).resolves.toBe('additional')

      expect(stripe.invoices.create).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ kind: 'additional', seats: '2' }) }))
    })

    it('alerts staff with the amount for places that came off, and moves no money', async () => {
      const stripe = stripeWithCap()
      paid(stripe)
      const f = fakeDb({ registrations: [{ ...REG, adult_count: 1, student_count: 16 }], participants: roster(17), group_invoices: paidLedger.map((r) => ({ ...r })) })

      await expect(settle(f, stripe)).resolves.toBe('alerted')

      expect(notifyCommunityAdmins).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringMatching(/refund \$194\.00 in Stripe/) }))
      expect(stripe.invoices.create).not.toHaveBeenCalled()
      expect(f.tables.registrations[0].invoice_sync_due_at).toBeNull()
    })
  })

  it('the daily backstop settles only what is overdue', async () => {
    const stripe = stripeWithCap()
    const f = fakeDb({
      registrations: [
        { ...REG, adult_count: 0, student_count: 5, invoice_sync_due_at: new Date(Date.now() - 1000).toISOString() },
        { ...REG, id: 'reg-2', invoice_sync_due_at: new Date(Date.now() + 60_000).toISOString() },
        { ...REG, id: 'reg-3', invoice_sync_due_at: null },
      ],
      participants: roster(5),
      group_invoices: [{ id: 'gi-0', registration_id: 'reg-1', stripe_invoice_id: 'in_0', kind: 'seats', status: 'open', seats: 7, per_seat_cents: 9700, created_at: '2026-11-05' }],
    })

    await expect(syncDueGroupInvoices(f.db, stripe as never)).resolves.toEqual({ revised: 1 })

    expect(stripe.invoices.sendInvoice).toHaveBeenCalledTimes(1)
  })

  it('flags an invoice for correction only when it is unpaid and out of step', () => {
    const base = { seats: 15, invoiceStatus: 'open', invoiceSeats: 17, paid: false, withdrawn: false }
    expect(invoiceNeedsCorrection(base)).toBe(true)
    expect(invoiceNeedsCorrection({ ...base, invoiceSeats: 15 })).toBe(false)
    expect(invoiceNeedsCorrection({ ...base, invoiceStatus: 'void' })).toBe(true)
    expect(invoiceNeedsCorrection({ ...base, invoiceStatus: 'paid' })).toBe(false)
    expect(invoiceNeedsCorrection({ ...base, paid: true })).toBe(false)
    expect(invoiceNeedsCorrection({ ...base, withdrawn: true })).toBe(false)
    expect(invoiceNeedsCorrection({ ...base, seats: 0, invoiceStatus: 'void' })).toBe(false)
  })
})

describe('removing someone still on an unpaid additional invoice', () => {
  function stripeWithAdditional() {
    const store = new Map<string, Row>([
      ['in_main', openInvoice('in_main', { status: 'paid' })],
      ['in_add', openInvoice('in_add', { metadata: { registrationId: 'reg-1', kind: 'additional' } })],
    ])
    return {
      ...fakeStripe(),
      store,
      invoices: {
        search: vi.fn(async () => ({ data: [] })),
        list: vi.fn(async () => ({ data: [] })),
        retrieve: vi.fn(async (id: string) => store.get(id)),
        create: vi.fn(async () => {
          const d = { ...openInvoice('in_add2'), status: 'draft', lines: { data: [{ id: 'il_1' }] } }
          store.set('in_add2', d)
          return d
        }),
        removeLines: vi.fn(async () => ({})),
        update: vi.fn(async () => ({})),
        finalizeInvoice: vi.fn(async (id: string) => Object.assign(store.get(id)!, { status: 'open', total: 9700 })),
        sendInvoice: vi.fn(async (id: string) => store.get(id)),
        voidInvoice: vi.fn(async (id: string) => Object.assign(store.get(id)!, { status: 'void' })),
      },
    }
  }
  const ledger = (seats: number, ids: string[]) => [
    { id: 'gi-m', registration_id: 'reg-1', stripe_invoice_id: 'in_main', kind: 'seats', status: 'paid', seats: 19, per_seat_cents: 9700, participant_ids: [], created_at: '2026-10-01' },
    { id: 'gi-a', registration_id: 'reg-1', stripe_invoice_id: 'in_add', kind: 'additional', status: 'open', seats, per_seat_cents: 9700, currency: 'usd', coupon_id: null, participant_ids: ids, created_at: '2026-11-01' },
  ]
  const paidReg = { ...REG, invoice_paid_at: '2026-10-02T00:00:00Z', stripe_payment_intent_id: 'pi_main', adult_count: 1, student_count: 19 }

  it('cancels the invoice when they were its only place', async () => {
    const stripe = stripeWithAdditional()
    const f = fakeDb({ registrations: [{ ...paidReg }], participants: roster(19), group_invoices: ledger(1, ['p19']) })

    const out = await applyRosterChange(f.db, stripe as never, {
      registrationId: 'reg-1', change: { kind: 'removed' }, eventRole: 'participant', participantIds: ['p19'], actor: { memberId: null, label: 'organiser' },
    })

    expect(out).toMatchObject({ action: 'voided', seatsAfter: 19, invoiceId: 'in_add' })
    expect(stripe.store.get('in_main')).toMatchObject({ status: 'paid' })
    expect(f.tables.group_invoices[1]).toMatchObject({ status: 'void' })
  })

  it('reduces the invoice when others remain on it, and drops them from its list', async () => {
    const stripe = stripeWithAdditional()
    const f = fakeDb({ registrations: [{ ...paidReg, student_count: 20 }], participants: roster(20), group_invoices: ledger(2, ['p19', 'p20']) })

    const out = await applyRosterChange(f.db, stripe as never, {
      registrationId: 'reg-1', change: { kind: 'removed' }, eventRole: 'participant', participantIds: ['p19'], actor: { memberId: null, label: 'organiser' },
    })

    expect(out).toMatchObject({ action: 'revised', invoiceId: 'in_add2' })
    expect(stripe.invoiceItems.create).toHaveBeenCalledWith(expect.objectContaining({ quantity: 1, invoice: 'in_add2' }))
    expect(f.tables.group_invoices.find((r) => r.stripe_invoice_id === 'in_add2')).toMatchObject({ kind: 'additional', seats: 1, participant_ids: ['p20'] })
  })

  it('leaves the invoice alone for someone the main invoice paid for', async () => {
    const stripe = stripeWithAdditional()
    const f = fakeDb({ registrations: [{ ...paidReg }], participants: roster(19), group_invoices: ledger(1, ['p19']) })

    const out = await applyRosterChange(f.db, stripe as never, {
      registrationId: 'reg-1', change: { kind: 'removed' }, eventRole: 'participant', participantIds: ['p3'], actor: { memberId: null, label: 'organiser' },
    })

    expect(out.action).toBe('none')
    expect(stripe.invoices.voidInvoice).not.toHaveBeenCalled()
  })

  it('trusts Stripe over a stale ledger row: a paid additional invoice is not "open"', async () => {
    const stripe = stripeWithAdditional()
    Object.assign(stripe.store.get('in_add')!, { status: 'paid' })
    const f = fakeDb({ group_invoices: ledger(1, ['p19']) })
    await expect(openAdditionalInvoiceFor(f.db, stripe as never, 'reg-1', 'p19')).resolves.toBeNull()
  })
})

describe('setGroupDiscount', () => {
  it('refuses to change an invoice that has been paid', async () => {
    const f = fakeDb({ registrations: [{ ...REG, invoice_paid_at: '2026-11-01T00:00:00Z' }], participants: roster(19), group_invoices: [] })
    const res = await setGroupDiscount(f.db, {} as never, 'reg-1', null, { memberId: null, label: 'admin' })
    expect(res).toMatchObject({ ok: false })
  })
})

describe('recordGroupInvoicePaid', () => {
  it('stores the payment on the participants an additional invoice covers, and reports its kind', async () => {
    const f = fakeDb({
      registrations: [{ ...REG }],
      participants: [{ id: 'p19', registration_id: 'reg-1', stripe_payment_intent_id: null }],
      group_invoices: [{ id: 'gi-1', stripe_invoice_id: 'in_add', kind: 'additional', seats: 1, participant_ids: ['p19'] }],
    })
    const stripe = {
      invoices: { retrieve: vi.fn(async () => ({ payments: { data: [{ status: 'paid', payment: { payment_intent: 'pi_add' } }] } })) },
    }
    const kind = await recordGroupInvoicePaid(f.db, stripe as never, {
      id: 'in_add', metadata: { registrationId: 'reg-1', kind: 'additional' }, status_transitions: { paid_at: 1_800_000_000 },
    } as never)

    expect(kind).toBe('additional')
    expect(f.tables.group_invoices[0]).toMatchObject({ status: 'paid', payment_intent_id: 'pi_add' })
    expect(f.tables.participants[0]).toMatchObject({ stripe_payment_intent_id: 'pi_add' })
    expect(f.tables.registrations[0].stripe_payment_intent_id).toBeNull()
  })
})
