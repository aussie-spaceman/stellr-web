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
  recordGroupInvoicePaid,
} from './group-billing'

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
    const match = (r: Row) => filters.every(([kind, col, val]) =>
      kind === 'eq' ? r[col] === val : kind === 'in' ? (val as unknown[]).includes(r[col]) : kind === 'is' ? (r[col] ?? null) === val : true)
    const run = () => {
      const rows = (tables[table] ??= [])
      if (op === 'update') {
        rows.filter(match).forEach((r) => Object.assign(r, values))
        writes.push({ table, op, values, filters: filters.map(([, c, v]) => [c, v]) })
        return { data: null, error: null }
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

  it('revises the open invoice to 18 places with the discount, and drops one student place', async () => {
    const f = fakeDb({ registrations: [{ ...REG, invoice_coupon_id: 'coupon_15', invoice_promotion_code: 'STEMCAREERS' }], participants: roster(18), group_invoices: [] })

    const out = await applyRosterChange(f.db, stripe as never, {
      registrationId: 'reg-1', change: { kind: 'removed' }, eventRole: 'participant', actor: { memberId: 'm-teacher', label: 'organiser' },
    })

    expect(out).toMatchObject({ action: 'revised', seatsAfter: 18, invoiceId: 'in_rev' })
    expect(out.message).toMatch(/updated invoice for 18 participants \(\$1,484\.10\)/)
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
      reason: 'Updated to 18 participants after a participant was removed (was 19)', created_by: 'm-teacher',
    })
  })

  it('reuses a draft revision someone started in the Dashboard (Stripe allows only one)', async () => {
    const f = fakeDb({ registrations: [{ ...REG }], participants: roster(18), group_invoices: [] })
    stripe.invoices.create.mockRejectedValueOnce(new Error('This invoice already has a draft revision'))
    const dashboardDraft = { ...openInvoice('in_rev'), status: 'draft', from_invoice: { action: 'revision', invoice: 'in_orig' }, lines: { data: [{ id: 'il_copy' }] } }
    stripe.store.set('in_rev', dashboardDraft)
    stripe.invoices.list.mockResolvedValueOnce({ data: [dashboardDraft] })

    const out = await applyRosterChange(f.db, stripe as never, {
      registrationId: 'reg-1', change: { kind: 'removed' }, eventRole: 'participant', actor: { memberId: null, label: 'admin' },
    })

    expect(out.action).toBe('revised')
    expect(stripe.invoices.removeLines).toHaveBeenCalledWith('in_rev', { lines: [{ id: 'il_copy', behavior: 'delete' }] })
  })

  it('voids the invoice when the last participant is removed', async () => {
    const f = fakeDb({ registrations: [{ ...REG, adult_count: 0, student_count: 1 }], participants: [], group_invoices: [] })

    const out = await applyRosterChange(f.db, stripe as never, {
      registrationId: 'reg-1', change: { kind: 'removed' }, eventRole: 'participant', actor: { memberId: null, label: 'admin' },
    })

    expect(out).toMatchObject({ action: 'voided', seatsAfter: 0 })
    expect(stripe.invoices.voidInvoice).toHaveBeenCalledWith('in_orig')
    expect(stripe.invoices.create).not.toHaveBeenCalled()
  })

  it('reports failure (and keeps the roster change) when Stripe refuses', async () => {
    const f = fakeDb({ registrations: [{ ...REG }], participants: roster(18), group_invoices: [] })
    stripe.invoices.create.mockRejectedValueOnce(new Error('Stripe is down'))
    stripe.invoices.list.mockResolvedValueOnce({ data: [] })

    const out = await applyRosterChange(f.db, stripe as never, {
      registrationId: 'reg-1', change: { kind: 'removed' }, eventRole: 'participant', actor: { memberId: null, label: 'admin' },
    })

    expect(out.action).toBe('failed')
    expect(out.message).toMatch(/our team has been alerted/)
    expect(f.tables.registrations[0]).toMatchObject({ student_count: 17 })
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
