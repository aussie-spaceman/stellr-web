import { describe, it, expect, vi, beforeEach } from 'vitest'

// Changing how a group pays after registering (6 Nov 2026). A teacher who chose an
// invoice asked for each person to pay instead. These pin what must hold whichever
// way a group moves: the old way to pay is closed before the new one opens, money
// already paid is never charged again, and any sign of a payment on its way stops
// the change with nothing moved.

vi.mock('server-only', () => ({}))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: async () => ({ stripePriceId: 'price_event' }) }))
vi.mock('@/lib/notify', () => ({ notifyCommunityAdmins: vi.fn(async () => {}) }))
vi.mock('@/lib/after-response', () => ({ runAfterResponse: vi.fn() }))
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: vi.fn() }))
// ensureIndividualPayments reads the price through its own client.
vi.mock('@/lib/stripe', () => ({
  stripeClient: () => ({ prices: { retrieve: async () => ({ unit_amount: 9700, currency: 'usd' }) } }),
}))
vi.mock('@/lib/email', async (original) => ({
  ...(await original<typeof import('@/lib/email')>()),
  sendEmail: vi.fn(async () => ({})),
}))

import {
  changeBlockReason,
  changeGroupPaymentMethod,
  classifyCheckouts,
  describeChange,
  notePaymentAfterMethodChange,
  paymentChangeView,
  type PaymentChangeFacts,
} from './group-payment-change'
import { syncGroupInvoice } from './group-billing'
import { sendEmail } from '@/lib/email'
import { notifyCommunityAdmins } from '@/lib/notify'

type Row = Record<string, unknown>

// ── Pure rules ───────────────────────────────────────────────────────────────

const FACTS: PaymentChangeFacts = {
  type: 'group', status: 'pending', mode: 'invoice', invoicePaid: false, cardPaid: false,
  declaredSeats: 15, paidSeats: 0, perSeatCents: 9700, currency: 'usd', coupon: null,
  rosterUnpaid: 15, rosterNoEmail: 0, openInvoiceNumber: 'INV-1',
}

describe('changeBlockReason', () => {
  it('lets an unpaid group change', () => {
    expect(changeBlockReason(FACTS)).toBeNull()
    expect(changeBlockReason({ ...FACTS, mode: 'individual', paidSeats: 3 })).toBeNull()
  })

  it.each<[string, Partial<PaymentChangeFacts>, RegExp]>([
    ['a paid invoice', { invoicePaid: true }, /invoice has been paid/],
    ['a card payment', { mode: 'card', cardPaid: true }, /paid by card/],
    ['everyone paid individually', { mode: 'individual', paidSeats: 15 }, /Everyone in this group has paid/],
    ['a withdrawn group', { status: 'withdrawn' }, /withdrawn/],
    ['a free event', { mode: 'free' }, /no fee/],
    ['an unreadable fee', { perSeatCents: null }, /can’t read this event’s fee/],
    ['no places', { declaredSeats: 0 }, /no places/],
  ])('refuses %s', (_name, change, reason) => {
    expect(changeBlockReason({ ...FACTS, ...change })).toMatch(reason)
  })
})

describe('describeChange', () => {
  it('says the invoice goes and each person gets a link', () => {
    const { effects } = describeChange(FACTS, 'individual')
    expect(effects[0]).toBe('Invoice INV-1 is cancelled.')
    expect(effects[1]).toMatch(/15 people on the roster are emailed a link to pay \$97\.00/)
  })

  it('prices only the unpaid places and says the paid ones stay paid', () => {
    const { effects } = describeChange({ ...FACTS, mode: 'individual', paidSeats: 3, openInvoiceNumber: null }, 'invoice')
    expect(effects).toEqual([
      'Payment links already sent stop working, and anyone who received one is told nothing is due.',
      'The organizer is emailed a new invoice for 12 places: $1,164.00, due in 14 days.',
      '3 places already paid individually stay paid.',
    ])
  })

  it('carries a percentage discount per person, and says a fixed one does not', () => {
    const percent = describeChange({ ...FACTS, coupon: { percentOff: 15, amountOffCents: null } }, 'individual').effects.join(' ')
    expect(percent).toContain('$82.45')
    const fixed = describeChange({ ...FACTS, coupon: { percentOff: null, amountOffCents: 5000 } }, 'individual').effects.join(' ')
    expect(fixed).toContain('$97.00')
    expect(fixed).toContain('can’t be split per person')
    expect(describeChange({ ...FACTS, coupon: { percentOff: null, amountOffCents: 5000 } }, 'card').effects.join(' ')).toContain('$1,405.00')
  })

  it('names people without an email address', () => {
    expect(describeChange({ ...FACTS, rosterNoEmail: 2 }, 'individual').effects.join(' ')).toContain('2 people on the roster have no email address')
  })

  it('marks a total Stripe cannot charge as unavailable', () => {
    expect(describeChange({ ...FACTS, perSeatCents: 10, declaredSeats: 2 }, 'card').unavailable).toMatch(/below the \$0\.50/)
    expect(describeChange({ ...FACTS, coupon: { percentOff: 100, amountOffCents: null } }, 'invoice').unavailable).toMatch(/\$0\.00/)
  })
})

describe('classifyCheckouts', () => {
  const session = (over: Row) => ({ id: 'cs_1', status: 'open', payment_status: 'unpaid', metadata: {}, ...over }) as never

  it('expires what is open', () => {
    expect(classifyCheckouts([session({})], new Map(), false)).toEqual({ toExpire: ['cs_1'], paymentInFlight: false })
  })

  it('stops for a completed seat payment not yet recorded', () => {
    const paid = session({ status: 'complete', metadata: { isIndividualGroupPayment: 'true', participantId: 'p1' } })
    expect(classifyCheckouts([paid], new Map([['p1', 'pending']]), false).paymentInFlight).toBe(true)
    expect(classifyCheckouts([paid], new Map([['p1', 'paid']]), false).paymentInFlight).toBe(false)
  })

  it('does not wait on someone who has left the roster', () => {
    const paid = session({ status: 'complete', metadata: { isIndividualGroupPayment: 'true', participantId: 'gone' } })
    expect(classifyCheckouts([paid], new Map(), false).paymentInFlight).toBe(false)
  })

  it('stops for a completed group payment not yet recorded', () => {
    expect(classifyCheckouts([session({ status: 'complete' })], new Map(), false).paymentInFlight).toBe(true)
    expect(classifyCheckouts([session({ status: 'complete' })], new Map(), true).paymentInFlight).toBe(false)
  })

  it('ignores an expired session', () => {
    expect(classifyCheckouts([session({ status: 'expired' })], new Map(), false)).toEqual({ toExpire: [], paymentInFlight: false })
  })
})

// ── The change, against fakes ────────────────────────────────────────────────

function fakeDb(tables: Record<string, Row[]>) {
  function builder(table: string) {
    const filters: [string, string, unknown][] = []
    let op: 'select' | 'update' | 'upsert' = 'select'
    let values: Row = {}
    let countMode = false
    const match = (r: Row) => filters.every(([kind, col, val]) =>
      kind === 'eq' ? r[col] === val
        : kind === 'in' ? (val as unknown[]).includes(r[col])
          : kind === 'is' ? (r[col] ?? null) === val
            : kind === 'or' ? (r.invoice_sync_lock_until ?? null) === null
              : true)
    const run = () => {
      const rows = (tables[table] ??= [])
      if (op === 'update') {
        const matched = rows.filter(match)
        matched.forEach((r) => Object.assign(r, values))
        return { data: matched, error: null }
      }
      if (op === 'upsert') {
        const existing = rows.find((r) => r.stripe_invoice_id === values.stripe_invoice_id)
        if (existing) Object.assign(existing, values)
        else rows.push({ id: `${table}-${rows.length}`, participant_ids: [], created_at: new Date(Date.now() + rows.length).toISOString(), ...values })
        return { data: null, error: null }
      }
      // Copies, as a database hands back: a later update doesn't reach rows already read.
      const out = rows.filter(match).map((r) => ({ ...r }))
      return countMode ? { data: null, count: out.length, error: null } : { data: out, error: null }
    }
    const q: Record<string, unknown> = {
      select: (_c?: string, opts?: { count?: string }) => { countMode = !!opts?.count; return q },
      eq: (c: string, v: unknown) => (filters.push(['eq', c, v]), q),
      in: (c: string, v: unknown[]) => (filters.push(['in', c, v]), q),
      is: (c: string, v: unknown) => (filters.push(['is', c, v]), q),
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
  return { from: builder } as never
}

function fakeStripe(opts: { invoice?: Row | null; sessions?: Row[] } = {}) {
  const store = new Map<string, Row>()
  if (opts.invoice) store.set(opts.invoice.id as string, opts.invoice)
  const sessions = opts.sessions ?? []
  let created = 0
  return {
    store,
    prices: { retrieve: vi.fn(async () => ({ unit_amount: 9700, currency: 'usd' })) },
    coupons: { retrieve: vi.fn(async (id: string) => ({ id, valid: true, percent_off: 15, amount_off: null })) },
    customers: { create: vi.fn(async () => ({ id: 'cus_new' })) },
    invoiceItems: { create: vi.fn(async () => ({ id: 'ii_1' })) },
    checkout: {
      sessions: {
        list: vi.fn(() => ({ autoPagingToArray: async () => sessions })),
        expire: vi.fn(async (id: string) => ({ id, status: 'expired' })),
        retrieve: vi.fn(async (id: string) => sessions.find((s) => s.id === id)),
      },
    },
    invoices: {
      search: vi.fn(async () => ({ data: [...store.values()] })),
      retrieve: vi.fn(async (id: string) => store.get(id)),
      voidInvoice: vi.fn(async (id: string) => Object.assign(store.get(id) as Row, { status: 'void' })),
      create: vi.fn(async () => {
        const id = `in_new${++created}`
        const draft = { id, status: 'draft', number: null, customer: 'cus_1', currency: 'usd', subtotal: 0, total: 0, total_discount_amounts: [], metadata: { registrationId: 'reg-1' } }
        store.set(id, draft)
        return draft
      }),
      finalizeInvoice: vi.fn(async (id: string) => {
        const seats = (stripeItemSeats.at(-1) ?? 0)
        return Object.assign(store.get(id) as Row, { status: 'open', number: `INV-${id}`, subtotal: seats * 9700, total: seats * 9700 })
      }),
      sendInvoice: vi.fn(async (id: string) => store.get(id)),
    },
  }
}
let stripeItemSeats: number[] = []

const REG = {
  id: 'reg-1', type: 'group', event_slug: 'msu', event_title: 'MSU Design Challenge', status: 'pending',
  invoice_requested: true, invoice_paid_at: null, member_pays_individually: false, stripe_payment_intent_id: null,
  amount_due_cents: 145_500, adult_count: 1, student_count: 14, teacher_first_name: 'T', teacher_last_name: 'Teacher',
  teacher_email: 'teacher@example.com', teacher_poc_email: null, teacher_member_id: 'm-teacher',
  invoice_coupon_id: null, invoice_promotion_code: null, invoice_sync_lock_until: null, invoice_sync_due_at: null,
  checkout_session_id: null, pay_link_sent_at: null, pay_token: null,
}

const person = (i: number, over: Row = {}) => ({
  id: `p${i}`, registration_id: 'reg-1', email: `p${i}@example.com`, first_name: `P${i}`, last_name: 'Student',
  individual_payment_status: null, individual_payment_link_sent_at: null, pay_token: null, ...over,
})
const roster = (n: number, over: (i: number) => Row = () => ({})) => Array.from({ length: n }, (_, i) => person(i, over(i)))

const OPEN = { id: 'in_orig', number: 'INV-1', status: 'open', customer: 'cus_1', currency: 'usd', subtotal: 145_500, total: 145_500, total_discount_amounts: [], metadata: { registrationId: 'reg-1', seats: '15' }, latest_revision: null }
const LEDGER = { id: 'l1', registration_id: 'reg-1', stripe_invoice_id: 'in_orig', stripe_invoice_number: 'INV-1', kind: 'seats', status: 'open', seats: 15, per_seat_cents: 9700, currency: 'usd', participant_ids: [], created_at: '2026-11-01T00:00:00Z' }

const STAFF = { memberId: 'm-admin', label: 'admin', by: 'staff' as const }
const TEACHER = { memberId: 'm-teacher', label: 'teacher', by: 'organizer' as const }

function setup(opts: { reg?: Row; people?: Row[]; ledger?: Row[]; invoice?: Row | null; sessions?: Row[] }) {
  const tables: Record<string, Row[]> = {
    registrations: [{ ...REG, ...opts.reg }],
    participants: opts.people ?? roster(15),
    group_invoices: opts.ledger ?? [],
    members: [{ id: 'm-teacher', stripe_customer_id: 'cus_1' }],
  }
  const stripe = fakeStripe({ invoice: opts.invoice === undefined ? null : opts.invoice, sessions: opts.sessions })
  stripe.invoiceItems.create = vi.fn(async (args: { quantity: number }) => { stripeItemSeats.push(args.quantity); return { id: 'ii_1' } }) as never
  return { db: fakeDb(tables), tables, stripe, reg: tables.registrations[0] }
}

const emailsTo = (addr: string) => vi.mocked(sendEmail).mock.calls.map((c) => c[0] as unknown as { to: string; subject: string; text: string }).filter((e) => e.to === addr)
const allEmails = () => vi.mocked(sendEmail).mock.calls.map((c) => c[0] as unknown as { to: string; subject: string; text: string })

beforeEach(() => {
  vi.mocked(sendEmail).mockClear()
  vi.mocked(notifyCommunityAdmins).mockClear()
  stripeItemSeats = []
})

describe('changeGroupPaymentMethod — from invoice', () => {
  it('to individual: voids the invoice, then emails each person a link and tells the organizer', async () => {
    const f = setup({ invoice: { ...OPEN }, ledger: [{ ...LEDGER }] })
    const out = await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'individual', TEACHER)

    expect(out).toMatchObject({ ok: true, method: 'individual' })
    expect(f.stripe.invoices.voidInvoice).toHaveBeenCalledWith('in_orig')
    expect(f.stripe.invoices.create).not.toHaveBeenCalled()
    expect(f.reg).toMatchObject({ invoice_requested: false, member_pays_individually: true, status: 'pending', amount_due_cents: 145_500 })
    expect(f.tables.group_invoices[0]).toMatchObject({ status: 'void' })
    expect(f.tables.participants.every((p) => p.individual_payment_status === 'pending' && p.individual_payment_link_sent_at)).toBe(true)
    expect(allEmails().filter((e) => e.subject.startsWith('Complete your payment'))).toHaveLength(15)
    const organizer = emailsTo('teacher@example.com')[0]
    expect(organizer.subject).toContain('payment method has changed')
    expect(organizer.text).toContain('Invoice INV-1 is cancelled')
    expect(notifyCommunityAdmins).toHaveBeenCalledOnce() // an organizer's own change is worth telling staff about
  })

  it('leaves out anyone with no email address, without failing', async () => {
    const f = setup({ invoice: { ...OPEN }, ledger: [{ ...LEDGER }], people: roster(3, (i) => (i === 2 ? { email: null } : {})) })
    const out = await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'individual', STAFF)
    expect(out.ok).toBe(true)
    expect(allEmails().filter((e) => e.subject.startsWith('Complete your payment'))).toHaveLength(2)
  })

  it('to card: voids the invoice and emails the pay link', async () => {
    const f = setup({ invoice: { ...OPEN }, ledger: [{ ...LEDGER }] })
    const out = await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'card', STAFF)
    expect(out).toMatchObject({ ok: true, method: 'card' })
    if (out.ok) expect(out.payUrl).toMatch(/\/register\/msu\/pay\/[a-f0-9]{64}$/)
    expect(f.stripe.invoices.voidInvoice).toHaveBeenCalledWith('in_orig')
    expect(f.reg).toMatchObject({ invoice_requested: false, member_pays_individually: false, amount_due_cents: 145_500 })
    expect(notifyCommunityAdmins).not.toHaveBeenCalled() // staff made this one
  })

  it('moves an unpaid group an admin had marked confirmed back to pending, or it would read as paid', async () => {
    const f = setup({ reg: { status: 'confirmed' }, invoice: { ...OPEN }, ledger: [{ ...LEDGER }] })
    await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'card', STAFF)
    expect(f.reg.status).toBe('pending')
  })

  it('voids an open "additional places" invoice too', async () => {
    const extra = { ...OPEN, id: 'in_extra', number: 'INV-2', metadata: { registrationId: 'reg-1', kind: 'additional' } }
    const f = setup({ invoice: { ...OPEN }, ledger: [{ ...LEDGER }, { ...LEDGER, id: 'l2', stripe_invoice_id: 'in_extra', kind: 'additional' }] })
    f.stripe.store.set('in_extra', extra)
    await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'card', STAFF)
    expect(f.stripe.invoices.voidInvoice).toHaveBeenCalledWith('in_extra')
  })
})

describe('changeGroupPaymentMethod — from individual', () => {
  const INDIVIDUAL = { invoice_requested: false, member_pays_individually: true }
  const threePaid = (i: number) => (i < 3
    ? { individual_payment_status: 'paid', individual_payment_link_sent_at: '2026-11-01T00:00:00Z' }
    : { individual_payment_status: 'pending', individual_payment_link_sent_at: '2026-11-01T00:00:00Z' })

  it('to invoice: bills only the unpaid places, keeps the paid ones, and stands the others down', async () => {
    const f = setup({ reg: INDIVIDUAL, people: roster(15, threePaid) })
    const out = await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'invoice', STAFF)

    expect(out).toMatchObject({ ok: true, method: 'invoice' })
    expect(stripeItemSeats).toEqual([12])
    expect(f.reg).toMatchObject({ invoice_requested: true, member_pays_individually: false, amount_due_cents: 116_400 })
    expect(f.tables.participants.filter((p) => p.individual_payment_status === 'paid')).toHaveLength(3)
    expect(f.tables.participants.filter((p) => p.individual_payment_status === null && p.individual_payment_link_sent_at === null)).toHaveLength(12)
    expect(allEmails().filter((e) => e.subject.startsWith('No payment needed from you'))).toHaveLength(12)
    expect(emailsTo('p0@example.com')).toHaveLength(0)
  })

  it('expires every open per-person checkout first, so an old link can no longer take money', async () => {
    const f = setup({ reg: INDIVIDUAL, people: roster(15, threePaid), sessions: [
      { id: 'cs_seat', status: 'open', metadata: { registrationId: 'reg-1', isIndividualGroupPayment: 'true', participantId: 'p5' } },
      { id: 'cs_other', status: 'open', metadata: { registrationId: 'someone-else' } },
    ] })
    await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'card', STAFF)
    expect(f.stripe.checkout.sessions.expire).toHaveBeenCalledTimes(1)
    expect(f.stripe.checkout.sessions.expire).toHaveBeenCalledWith('cs_seat')
    expect(f.reg.amount_due_cents).toBe(116_400)
  })

  it('stays billed correctly through a later sync: the paid places never join the invoice', async () => {
    const f = setup({ reg: INDIVIDUAL, people: roster(15, threePaid) })
    await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'invoice', STAFF)
    f.reg.invoice_sync_due_at = new Date(Date.now() - 1000).toISOString()
    f.stripe.invoices.create.mockClear()
    expect(await syncGroupInvoice(f.db, f.stripe as never, 'reg-1')).toBe('none')
    expect(f.stripe.invoices.create).not.toHaveBeenCalled()
  })

  it('and back again: someone stood down gets a fresh link', async () => {
    const f = setup({ reg: INDIVIDUAL, people: roster(4, threePaid) })
    await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'card', STAFF)
    vi.mocked(sendEmail).mockClear()
    await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'individual', STAFF)
    expect(allEmails().filter((e) => e.subject.startsWith('Complete your payment')).map((e) => e.to)).toEqual(['p3@example.com'])
  })
})

describe('changeGroupPaymentMethod — from card', () => {
  const CARD = { invoice_requested: false, checkout_session_id: 'cs_card' }

  it('to invoice: expires the open checkout and sends an invoice with the group price', async () => {
    const f = setup({ reg: CARD, sessions: [{ id: 'cs_card', status: 'open', metadata: { registrationId: 'reg-1', isGroup: 'true' } }] })
    const out = await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'invoice', STAFF)
    expect(out.ok).toBe(true)
    expect(f.stripe.checkout.sessions.expire).toHaveBeenCalledWith('cs_card')
    expect(stripeItemSeats).toEqual([15])
    expect(f.reg).toMatchObject({ invoice_requested: true, checkout_session_id: null })
    expect(f.stripe.invoices.sendInvoice).toHaveBeenCalled()
  })
})

describe('changeGroupPaymentMethod — refusals leave the group as it was', () => {
  const unchanged = (f: ReturnType<typeof setup>) => {
    expect(f.stripe.invoices.voidInvoice).not.toHaveBeenCalled()
    expect(f.stripe.invoices.create).not.toHaveBeenCalled()
    expect(f.reg.invoice_requested).toBe(true)
    expect(f.reg.member_pays_individually).toBe(false)
    expect(f.reg.invoice_sync_lock_until).toBeNull()
  }

  it('an invoice Stripe says is paid, even if the webhook never arrived', async () => {
    const f = setup({ invoice: { ...OPEN, status: 'paid' }, ledger: [{ ...LEDGER }] })
    expect(await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'card', STAFF)).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/has been paid/) })
    unchanged(f)
  })

  it('a card payment that has completed but not yet recorded', async () => {
    const f = setup({ invoice: { ...OPEN }, ledger: [{ ...LEDGER }], sessions: [{ id: 'cs_paid', status: 'complete', payment_status: 'paid', metadata: { registrationId: 'reg-1', isGroup: 'true' } }] })
    expect(await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'individual', STAFF)).toMatchObject({ ok: false, error: expect.stringMatching(/going through/) })
    unchanged(f)
  })

  it('a checkout that cannot be expired because it was just paid', async () => {
    const f = setup({ invoice: { ...OPEN }, ledger: [{ ...LEDGER }], sessions: [{ id: 'cs_open', status: 'open', metadata: { registrationId: 'reg-1' } }] })
    f.stripe.checkout.sessions.expire.mockRejectedValueOnce(new Error('already complete'))
    f.stripe.checkout.sessions.retrieve.mockResolvedValueOnce({ id: 'cs_open', status: 'complete' } as never)
    expect(await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'individual', STAFF)).toMatchObject({ ok: false, status: 409 })
    unchanged(f)
  })

  it('an invoice Stripe will not void: the flags do not move', async () => {
    const f = setup({ invoice: { ...OPEN }, ledger: [{ ...LEDGER }] })
    f.stripe.invoices.voidInvoice.mockRejectedValueOnce(new Error('payment processing'))
    expect(await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'individual', STAFF)).toMatchObject({ ok: false, error: expect.stringMatching(/couldn’t be cancelled/) })
    expect(f.reg.invoice_requested).toBe(true)
    expect(allEmails()).toHaveLength(0)
  })

  it('the method the group already uses', async () => {
    const f = setup({ invoice: { ...OPEN }, ledger: [{ ...LEDGER }] })
    expect(await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'invoice', STAFF)).toMatchObject({ ok: false, error: expect.stringMatching(/already pays/) })
    unchanged(f)
  })

  it('another change holding the lock', async () => {
    const f = setup({ reg: { invoice_sync_lock_until: new Date(Date.now() + 60_000).toISOString() }, invoice: { ...OPEN }, ledger: [{ ...LEDGER }] })
    expect(await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'card', STAFF)).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/right now/) })
    expect(f.stripe.invoices.voidInvoice).not.toHaveBeenCalled()
  })
})

describe('changeGroupPaymentMethod — a failure once the group has moved', () => {
  it('keeps the move, alerts staff, and says so rather than claiming success', async () => {
    const f = setup({ reg: { invoice_requested: false, member_pays_individually: true }, people: roster(2, () => ({ individual_payment_status: 'pending' })) })
    f.stripe.invoices.finalizeInvoice.mockRejectedValueOnce(new Error('Stripe is down'))
    const out = await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'invoice', STAFF)
    expect(out).toMatchObject({ ok: true, message: expect.stringMatching(/Stripe is down.*team has been alerted/) })
    expect(f.reg.invoice_requested).toBe(true)
    expect(notifyCommunityAdmins).toHaveBeenCalledOnce()
  })
})

describe('paymentChangeView', () => {
  it('offers the two other methods for an unpaid group', async () => {
    const f = setup({ invoice: { ...OPEN }, ledger: [{ ...LEDGER }] })
    const view = await paymentChangeView(f.db, f.stripe as never, 'reg-1')
    expect(view).toMatchObject({ current: 'invoice', blockedReason: null })
    expect(view?.options.map((o) => o.method)).toEqual(['card', 'individual'])
    expect(f.stripe.invoices.voidInvoice).not.toHaveBeenCalled()
  })

  it('offers nothing for a paid group, and says why', async () => {
    const f = setup({ reg: { invoice_paid_at: '2026-11-02T00:00:00Z' }, invoice: { ...OPEN, status: 'paid' }, ledger: [{ ...LEDGER }] })
    expect(await paymentChangeView(f.db, f.stripe as never, 'reg-1')).toMatchObject({ options: [], blockedReason: expect.stringMatching(/has been paid/) })
  })
})

describe('notePaymentAfterMethodChange', () => {
  it('stays quiet when the payment matches how the group pays', async () => {
    const seat = setup({ reg: { invoice_requested: false, member_pays_individually: true } })
    await notePaymentAfterMethodChange(seat.db, 'reg-1', 'seat')
    const group = setup({ reg: { invoice_requested: false } })
    await notePaymentAfterMethodChange(group.db, 'reg-1', 'group')
    expect(notifyCommunityAdmins).not.toHaveBeenCalled()
  })

  it('a seat paid on an invoiced group shrinks the invoice at its next sync, and alerts staff', async () => {
    const f = setup({})
    await notePaymentAfterMethodChange(f.db, 'reg-1', 'seat')
    expect(f.reg.invoice_sync_due_at).toBeTruthy()
    expect(notifyCommunityAdmins).toHaveBeenCalledOnce()
  })

  it('a group card payment on a group that moved alerts staff', async () => {
    const f = setup({})
    await notePaymentAfterMethodChange(f.db, 'reg-1', 'group')
    expect(notifyCommunityAdmins).toHaveBeenCalledOnce()
  })
})
