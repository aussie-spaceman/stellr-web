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
    let op: 'select' | 'update' | 'upsert' | 'insert' = 'select'
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
      if (op === 'insert') { rows.push({ ...values }); return { data: null, error: null } }
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
      insert: (v: Row) => { op = 'insert'; values = v; return q },
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
    refunds: { create: vi.fn(async (args: { amount: number }) => ({ id: `re_${args.amount}` })) },
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

const CREW = { memberId: 'm-admin', label: 'admin', by: 'crew' as const }
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
    const out = await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'individual', CREW)
    expect(out.ok).toBe(true)
    expect(allEmails().filter((e) => e.subject.startsWith('Complete your payment'))).toHaveLength(2)
  })

  it('to card: voids the invoice and emails the pay link', async () => {
    const f = setup({ invoice: { ...OPEN }, ledger: [{ ...LEDGER }] })
    const out = await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'card', CREW)
    expect(out).toMatchObject({ ok: true, method: 'card' })
    if (out.ok) expect(out.payUrl).toMatch(/\/register\/msu\/pay\/[a-f0-9]{64}$/)
    expect(f.stripe.invoices.voidInvoice).toHaveBeenCalledWith('in_orig')
    expect(f.reg).toMatchObject({ invoice_requested: false, member_pays_individually: false, amount_due_cents: 145_500 })
    expect(notifyCommunityAdmins).not.toHaveBeenCalled() // staff made this one
  })

  it('moves an unpaid group an admin had marked confirmed back to pending, or it would read as paid', async () => {
    const f = setup({ reg: { status: 'confirmed' }, invoice: { ...OPEN }, ledger: [{ ...LEDGER }] })
    await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'card', CREW)
    expect(f.reg.status).toBe('pending')
  })

  it('voids an open "additional places" invoice too', async () => {
    const extra = { ...OPEN, id: 'in_extra', number: 'INV-2', metadata: { registrationId: 'reg-1', kind: 'additional' } }
    const f = setup({ invoice: { ...OPEN }, ledger: [{ ...LEDGER }, { ...LEDGER, id: 'l2', stripe_invoice_id: 'in_extra', kind: 'additional' }] })
    f.stripe.store.set('in_extra', extra)
    await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'card', CREW)
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
    const out = await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'invoice', CREW)

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
    await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'card', CREW)
    expect(f.stripe.checkout.sessions.expire).toHaveBeenCalledTimes(1)
    expect(f.stripe.checkout.sessions.expire).toHaveBeenCalledWith('cs_seat')
    expect(f.reg.amount_due_cents).toBe(116_400)
  })

  it('stays billed correctly through a later sync: the paid places never join the invoice', async () => {
    const f = setup({ reg: INDIVIDUAL, people: roster(15, threePaid) })
    await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'invoice', CREW)
    f.reg.invoice_sync_due_at = new Date(Date.now() - 1000).toISOString()
    f.stripe.invoices.create.mockClear()
    expect(await syncGroupInvoice(f.db, f.stripe as never, 'reg-1')).toBe('none')
    expect(f.stripe.invoices.create).not.toHaveBeenCalled()
  })

  it('and back again: someone stood down gets a fresh link', async () => {
    const f = setup({ reg: INDIVIDUAL, people: roster(4, threePaid) })
    await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'card', CREW)
    vi.mocked(sendEmail).mockClear()
    await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'individual', CREW)
    expect(allEmails().filter((e) => e.subject.startsWith('Complete your payment')).map((e) => e.to)).toEqual(['p3@example.com'])
  })
})

describe('changeGroupPaymentMethod — from card', () => {
  const CARD = { invoice_requested: false, checkout_session_id: 'cs_card' }

  it('to invoice: expires the open checkout and sends an invoice with the group price', async () => {
    const f = setup({ reg: CARD, sessions: [{ id: 'cs_card', status: 'open', metadata: { registrationId: 'reg-1', isGroup: 'true' } }] })
    const out = await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'invoice', CREW)
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
    expect(await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'card', CREW)).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/has been paid/) })
    unchanged(f)
  })

  it('a card payment that has completed but not yet recorded', async () => {
    const f = setup({ invoice: { ...OPEN }, ledger: [{ ...LEDGER }], sessions: [{ id: 'cs_paid', status: 'complete', payment_status: 'paid', metadata: { registrationId: 'reg-1', isGroup: 'true' } }] })
    expect(await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'individual', CREW)).toMatchObject({ ok: false, error: expect.stringMatching(/going through/) })
    unchanged(f)
  })

  it('a checkout that cannot be expired because it was just paid', async () => {
    const f = setup({ invoice: { ...OPEN }, ledger: [{ ...LEDGER }], sessions: [{ id: 'cs_open', status: 'open', metadata: { registrationId: 'reg-1' } }] })
    f.stripe.checkout.sessions.expire.mockRejectedValueOnce(new Error('already complete'))
    f.stripe.checkout.sessions.retrieve.mockResolvedValueOnce({ id: 'cs_open', status: 'complete' } as never)
    expect(await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'individual', CREW)).toMatchObject({ ok: false, status: 409 })
    unchanged(f)
  })

  it('an invoice Stripe will not void: the flags do not move', async () => {
    const f = setup({ invoice: { ...OPEN }, ledger: [{ ...LEDGER }] })
    f.stripe.invoices.voidInvoice.mockRejectedValueOnce(new Error('payment processing'))
    expect(await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'individual', CREW)).toMatchObject({ ok: false, error: expect.stringMatching(/couldn’t be cancelled/) })
    expect(f.reg.invoice_requested).toBe(true)
    expect(allEmails()).toHaveLength(0)
  })

  it('the method the group already uses', async () => {
    const f = setup({ invoice: { ...OPEN }, ledger: [{ ...LEDGER }] })
    expect(await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'invoice', CREW)).toMatchObject({ ok: false, error: expect.stringMatching(/already pays/) })
    unchanged(f)
  })

  it('another change holding the lock', async () => {
    const f = setup({ reg: { invoice_sync_lock_until: new Date(Date.now() + 60_000).toISOString() }, invoice: { ...OPEN }, ledger: [{ ...LEDGER }] })
    expect(await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'card', CREW)).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/right now/) })
    expect(f.stripe.invoices.voidInvoice).not.toHaveBeenCalled()
  })
})

describe('changeGroupPaymentMethod — a failure once the group has moved', () => {
  it('keeps the move, alerts staff, and says so rather than claiming success', async () => {
    const f = setup({ reg: { invoice_requested: false, member_pays_individually: true }, people: roster(2, () => ({ individual_payment_status: 'pending' })) })
    f.stripe.invoices.finalizeInvoice.mockRejectedValueOnce(new Error('Stripe is down'))
    const out = await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'invoice', CREW)
    expect(out).toMatchObject({ ok: true, message: expect.stringMatching(/Stripe is down.*team has been alerted/) })
    expect(f.reg.invoice_requested).toBe(true)
    expect(notifyCommunityAdmins).toHaveBeenCalledOnce()
  })
})

describe('paymentChangeView', () => {
  it('offers the other methods for an unpaid group, including invoicing only some', async () => {
    const f = setup({ invoice: { ...OPEN }, ledger: [{ ...LEDGER }] })
    const view = await paymentChangeView(f.db, f.stripe as never, 'reg-1')
    expect(view).toMatchObject({ current: 'invoice', blockedReason: null })
    expect(view?.options.map((o) => o.method)).toEqual(['invoice_some', 'card', 'individual', 'teacher_share'])
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

// ── "Invoice for some" (9 Nov 2026) ─────────────────────────────────────────
// A teacher who had moved her group to individual payment asked for an invoice
// for herself only, her students paying by their own links.

describe('changeGroupPaymentMethod — invoice for some', () => {
  const INDIVIDUAL = { invoice_requested: false, member_pays_individually: true, adult_count: 1, student_count: 3 }
  const SENT = '2026-11-09T17:00:00Z'
  // p0 is the teacher; p1–p3 students. Everyone was sent a link on the switch to individual.
  const msuGroup = () => roster(4, (i) => ({
    event_role: i === 0 ? 'teacher' : 'participant',
    individual_payment_status: 'pending',
    individual_payment_link_sent_at: SENT,
  }))
  const split = (ids: string[], lateJoinerPayer: 'self' | 'group' = 'self') =>
    ({ method: 'invoice_some' as const, invoiceParticipantIds: ids, lateJoinerPayer })

  it('from individual: invoices the teacher alone, stands down her link, and leaves the students’ links alone', async () => {
    const f = setup({ reg: INDIVIDUAL, people: msuGroup() })
    const out = await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', split(['p0']), CREW)

    expect(out).toMatchObject({ ok: true, method: 'invoice_some' })
    expect(stripeItemSeats).toEqual([1])
    expect(f.reg).toMatchObject({ invoice_requested: true, member_pays_individually: false, late_joiner_payer: 'self', amount_due_cents: 9700, status: 'pending' })
    const [teacher, ...students] = f.tables.participants
    expect(teacher).toMatchObject({ payer: 'group', individual_payment_status: null, individual_payment_link_sent_at: null })
    expect(students.every((p) => p.payer === 'self' && p.individual_payment_status === 'pending' && p.individual_payment_link_sent_at === SENT)).toBe(true)
    expect(emailsTo('p0@example.com').map((e) => e.subject)).toEqual([expect.stringMatching(/^No payment needed from you/)])
    // No student is emailed again: their links already work.
    expect(allEmails().filter((e) => e.subject.startsWith('Complete your payment'))).toHaveLength(0)
    expect(emailsTo('teacher@example.com')[0].text).toContain('A new invoice for 1 place')
  })

  it('from an open invoice: revises it after the quiet period instead of cancelling it, and links go to the rest', async () => {
    const people = roster(4, (i) => ({ event_role: i === 0 ? 'teacher' : 'participant' }))
    const f = setup({ reg: { adult_count: 1, student_count: 3 }, people, invoice: { ...OPEN }, ledger: [{ ...LEDGER, seats: 4 }] })
    const out = await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', split(['p0']), TEACHER)

    expect(out).toMatchObject({ ok: true })
    expect(f.stripe.invoices.voidInvoice).not.toHaveBeenCalled()
    expect(f.stripe.invoices.create).not.toHaveBeenCalled()
    expect(f.reg.invoice_sync_due_at).toBeTruthy()
    expect(f.reg.amount_due_cents).toBe(9700)
    expect(allEmails().filter((e) => e.subject.startsWith('Complete your payment')).map((e) => e.to)).toEqual(['p1@example.com', 'p2@example.com', 'p3@example.com'])
  })

  it('later: moving a student onto the invoice stands their link down and queues the invoice update', async () => {
    const f = setup({ reg: INDIVIDUAL, people: msuGroup() })
    await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', split(['p0']), CREW)
    vi.mocked(sendEmail).mockClear()
    f.reg.invoice_sync_due_at = null

    const out = await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', split(['p0', 'p1']), TEACHER)
    expect(out).toMatchObject({ ok: true })
    expect(f.stripe.invoices.voidInvoice).not.toHaveBeenCalled()
    expect(f.reg.invoice_sync_due_at).toBeTruthy()
    expect(f.reg.amount_due_cents).toBe(19_400)
    expect(f.tables.participants[1]).toMatchObject({ payer: 'group', individual_payment_status: null })
    expect(emailsTo('p1@example.com').map((e) => e.subject)).toEqual([expect.stringMatching(/^No payment needed from you/)])
  })

  it('later joiners on the invoice: unfilled declared places are billed too', async () => {
    const f = setup({ reg: { ...INDIVIDUAL, student_count: 5 }, people: msuGroup() })
    await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', split(['p0'], 'group'), CREW)
    expect(stripeItemSeats).toEqual([3]) // the teacher + 2 places nobody has filled yet
  })

  it.each<[string, string[], RegExp]>([
    ['a place already paid', ['p0', 'p1'], /already paid/],
    ['nobody on the invoice', [], /Nobody would be on the invoice/],
    ['someone not in the group', ['p0', '00000000-0000-0000-0000-000000000000'], /isn’t in this group/],
  ])('refuses %s, and nothing moves', async (_name, ids, reason) => {
    const people = msuGroup()
    ;(people[1] as Row).individual_payment_status = 'paid'
    const f = setup({ reg: INDIVIDUAL, people })
    const out = await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', split(ids), CREW)
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(reason) })
    expect(f.reg).toMatchObject({ member_pays_individually: true, invoice_requested: false })
    expect(f.stripe.invoices.create).not.toHaveBeenCalled()
  })

  it('refuses a change that changes nothing', async () => {
    const f = setup({ reg: INDIVIDUAL, people: msuGroup() })
    await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', split(['p0']), CREW)
    const again = await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', split(['p0']), CREW)
    expect(again).toMatchObject({ ok: false, error: expect.stringMatching(/Nothing would change/) })
  })

  it('back to everyone individually: the invoice goes, the teacher gets a link, and the group stops being split', async () => {
    const f = setup({ reg: INDIVIDUAL, people: msuGroup() })
    await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', split(['p0']), CREW)
    vi.mocked(sendEmail).mockClear()
    const out = await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'individual', CREW)
    expect(out).toMatchObject({ ok: true })
    expect(f.stripe.invoices.voidInvoice).toHaveBeenCalled()
    expect(f.reg).toMatchObject({ member_pays_individually: true, invoice_requested: false, late_joiner_payer: null })
    expect(f.tables.participants.every((p) => p.payer === null)).toBe(true)
    expect(allEmails().filter((e) => e.subject.startsWith('Complete your payment')).map((e) => e.to)).toEqual(['p0@example.com'])
  })

  it('a student’s own seat payment on a split group is expected: no staff alert', async () => {
    const f = setup({ reg: { member_pays_individually: false, late_joiner_payer: 'self' } })
    await notePaymentAfterMethodChange(f.db, 'reg-1', 'seat')
    expect(notifyCommunityAdmins).not.toHaveBeenCalled()
  })

  it('the view lists people to tick: adults ticked by default, paid places locked', async () => {
    const people = msuGroup()
    ;(people[2] as Row).individual_payment_status = 'paid'
    const f = setup({ reg: INDIVIDUAL, people })
    const view = await paymentChangeView(f.db, f.stripe as never, 'reg-1')
    expect(view?.options.map((o) => o.method)).toEqual(['invoice', 'invoice_some', 'card', 'teacher_share'])
    expect(view?.split?.people.map((p) => [p.id, p.onInvoice, p.locked])).toEqual([
      ['p0', true, null], ['p1', false, null], ['p2', false, 'Paid'], ['p3', false, null],
    ])
    expect(view?.split).toMatchObject({ lateJoinerPayer: 'self', unfilledSeats: 0, perSeatCents: 9700 })
  })
})

// ── Students share the teacher's cost (9 Nov 2026) ──────────────────────────

describe('changeGroupPaymentMethod — students share the teacher’s cost', () => {
  const INDIVIDUAL = { invoice_requested: false, member_pays_individually: true, adult_count: 1, student_count: 3 }
  const SENT = '2026-11-09T17:00:00Z'
  const msuGroup = () => roster(4, (i) => ({
    event_role: i === 0 ? 'teacher' : 'participant',
    individual_payment_status: 'pending',
    individual_payment_link_sent_at: SENT,
  }))
  const share = (shareEstimate: number) => ({ method: 'teacher_share' as const, shareEstimate })

  it('from individual: the teacher is covered and stood down, the students keep their links, and the share is set', async () => {
    const f = setup({ reg: INDIVIDUAL, people: msuGroup() })
    const out = await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', share(4), CREW)

    expect(out).toMatchObject({ ok: true, method: 'teacher_share' })
    expect(f.reg).toMatchObject({ member_pays_individually: true, invoice_requested: false, share_estimate: 4, share_unit_cents: 9700, share_cents: 2425 })
    expect(f.tables.participants[0]).toMatchObject({ payer: 'shared', individual_payment_status: 'covered' })
    expect(f.tables.participants.slice(1).every((p) => p.payer === 'self' && p.individual_payment_status === 'pending')).toBe(true)
    expect(emailsTo('p0@example.com').map((e) => e.subject)).toEqual([expect.stringMatching(/^No payment needed from you/)])
    expect(allEmails().filter((e) => e.subject.startsWith('Complete your payment'))).toHaveLength(0)
    if (out.ok) expect(out.message).toContain('$24.25')
  })

  it('from an invoice: the invoice goes, students get links', async () => {
    const people = roster(4, (i) => ({ event_role: i === 0 ? 'teacher' : 'participant' }))
    const f = setup({ reg: { adult_count: 1, student_count: 3 }, people, invoice: { ...OPEN }, ledger: [{ ...LEDGER, seats: 4 }] })
    const out = await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', share(3), TEACHER)
    expect(out).toMatchObject({ ok: true })
    expect(f.stripe.invoices.voidInvoice).toHaveBeenCalledWith('in_orig')
    expect(allEmails().filter((e) => e.subject.startsWith('Complete your payment')).map((e) => e.to)).toEqual(['p1@example.com', 'p2@example.com', 'p3@example.com'])
    expect(f.reg.share_cents).toBe(3233)
  })

  it('refuses when every adult has already paid', async () => {
    const people = msuGroup()
    ;(people[0] as Row).individual_payment_status = 'paid'
    const f = setup({ reg: INDIVIDUAL, people })
    expect(await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', share(4), CREW)).toMatchObject({ ok: false, error: expect.stringMatching(/already paid/) })
  })

  it('the estimate can go up any time, but down only before a student has paid', async () => {
    const f = setup({ reg: INDIVIDUAL, people: msuGroup() })
    await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', share(4), CREW)
    expect(await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', share(2), TEACHER)).toMatchObject({ ok: true })
    expect(f.reg).toMatchObject({ share_estimate: 2, share_cents: 3233 }) // 3 students on the roster beat 2

    f.reg.share_first_paid_at = '2026-11-10T00:00:00Z'
    expect(await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', share(1), TEACHER)).toMatchObject({ ok: false, error: expect.stringMatching(/can only go up/) })
    expect(await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', share(5), TEACHER)).toMatchObject({ ok: true })
    expect(f.reg).toMatchObject({ share_estimate: 5, share_cents: 1940 })
  })

  it('leaving it: shares paid are refunded and the teacher gets a link of their own', async () => {
    const f = setup({ reg: INDIVIDUAL, people: msuGroup() })
    await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', share(4), CREW)
    Object.assign(f.tables.participants[1], { individual_payment_status: 'paid', share_paid_cents: 2425, base_paid_cents: 9700, stripe_payment_intent_id: 'pi_p1' })
    f.reg.share_first_paid_at = '2026-11-10T00:00:00Z'
    vi.mocked(sendEmail).mockClear()

    const out = await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'individual', CREW)
    expect(out).toMatchObject({ ok: true })
    expect(f.stripe.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: 'pi_p1', amount: 2425 }), expect.anything())
    expect(f.reg).toMatchObject({ share_estimate: null, member_pays_individually: true })
    expect(allEmails().filter((e) => e.subject.startsWith('Complete your payment')).map((e) => e.to)).toEqual(['p0@example.com'])
    if (out.ok) expect(out.message).toMatch(/1 share of the teacher’s cost has been refunded/)
  })

  it('after settlement, nothing changes', async () => {
    const f = setup({ reg: { ...INDIVIDUAL, share_estimate: 4, share_unit_cents: 9700, share_cents: 2425, share_settled_at: '2026-11-21T06:00:00Z' }, people: msuGroup() })
    expect(await changeGroupPaymentMethod(f.db, f.stripe as never, 'reg-1', 'individual', CREW)).toMatchObject({ ok: false, error: expect.stringMatching(/settled after the event/) })
  })

  it('the view offers it with the numbers the dialog needs', async () => {
    const f = setup({ reg: INDIVIDUAL, people: msuGroup() })
    const view = await paymentChangeView(f.db, f.stripe as never, 'reg-1')
    expect(view?.options.map((o) => o.method)).toContain('teacher_share')
    expect(view?.share).toMatchObject({ unitCents: 9700, unpaidAdults: 1, students: 3, current: null })
  })
})

