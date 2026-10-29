import Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getEventBySlug } from '@/lib/sanity'
import { GUARANTEE_RECEIPT_LINE } from '@/lib/guarantee'
import { normalizeEventRole } from '@/lib/member-enums'

// What a group pays when its roster changes after registration (29 Oct 2026).
//
// A group's declared size (adult_count + student_count) is what it is billed
// for and what caps its join link. Removing a participant always frees their
// place: the size drops by one. Adding someone beyond the declared size grows
// it. What happens to the money then depends on how the group pays:
//
//   invoice, unpaid  → the open invoice is revised (Stripe's own revision:
//                      the old one is voided, the new one emailed), keeping
//                      any discount an admin applied.
//   invoice or card, → a removed place is refunded by the caller through
//   already paid       executeRefund (the 45-day guarantee applies); an added
//                      place gets its own "additional" invoice.
//   members pay      → each seat is its own payment; executeRefund refunds it.
//   individually
//   free / campaign  → nothing to bill.
//
// Every invoice issued for a group is recorded in group_invoices
// (supabase/migrations/20261029120000_group_invoices.sql), with the reason the
// organiser sees in the Billing tab. Stripe stays the source of truth for an
// invoice's status: it is re-read before any action.

type Db = SupabaseClient

export type GroupBillingMode = 'invoice' | 'card' | 'individual' | 'free'
export type LedgerStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible'

export interface GroupInvoiceRow {
  id: string
  registration_id: string | null
  event_slug: string | null
  stripe_invoice_id: string
  stripe_invoice_number: string | null
  kind: 'seats' | 'additional'
  status: LedgerStatus
  seats: number
  per_seat_cents: number
  subtotal_cents: number
  discount_cents: number
  total_cents: number
  currency: string
  coupon_id: string | null
  promotion_code: string | null
  replaces_stripe_invoice_id: string | null
  reason: string | null
  participant_ids: string[]
  payment_intent_id: string | null
  paid_at: string | null
  voided_at: string | null
  created_by: string | null
  created_at: string
}

export interface GroupRegistration {
  id: string
  type: string
  event_slug: string
  event_title: string
  status: string
  invoice_requested: boolean | null
  invoice_paid_at: string | null
  member_pays_individually: boolean | null
  stripe_payment_intent_id: string | null
  amount_due_cents: number | null
  adult_count: number | null
  student_count: number | null
  teacher_first_name: string | null
  teacher_last_name: string | null
  teacher_email: string | null
  teacher_member_id: string | null
  invoice_coupon_id: string | null
  invoice_promotion_code: string | null
}

const REG_COLUMNS =
  'id, type, event_slug, event_title, status, invoice_requested, invoice_paid_at, member_pays_individually, ' +
  'stripe_payment_intent_id, amount_due_cents, adult_count, student_count, teacher_first_name, teacher_last_name, ' +
  'teacher_email, teacher_member_id, invoice_coupon_id, invoice_promotion_code'

// ── Pure rules ───────────────────────────────────────────────────────────────

/** A student-manager is the group's first student; every other non-participant role is an adult. */
export function seatBucket(eventRole: string | null | undefined): 'student' | 'adult' {
  const role = normalizeEventRole(eventRole)
  return role === 'participant' || role === 'school_student_manager' ? 'student' : 'adult'
}

export function billingMode(reg: Pick<GroupRegistration, 'member_pays_individually' | 'invoice_requested' | 'stripe_payment_intent_id' | 'amount_due_cents' | 'type' | 'status'>): GroupBillingMode {
  if (reg.type === 'campaign') return 'free'
  if (reg.member_pays_individually) return 'individual'
  if (reg.invoice_requested) return 'invoice'
  if (reg.stripe_payment_intent_id) return 'card'
  // Confirmed with nothing collected = a free event; pending = card, not yet paid.
  if ((reg.amount_due_cents ?? 0) <= 0) return 'free'
  return 'card'
}

export type SeatChange = { kind: 'removed' } | { kind: 'added'; count: number }

export interface SeatPlanInput {
  mode: GroupBillingMode
  /** Declared places before the change. */
  seatsBefore: number
  /** Participants on the roster after the change. */
  rosterAfter: number
  change: SeatChange
  /** The group's main invoice: open (unpaid), paid, or none issued. */
  invoice: 'open' | 'paid' | 'none'
  /** Card groups: whether the card payment has been taken. */
  cardPaid: boolean
}

export interface SeatPlan {
  seatsAfter: number
  /** What to do with the group's invoices. */
  invoice: 'revise' | 'void' | 'additional' | 'none'
  /** Places to bill on a new "additional" invoice. */
  additionalSeats: number
}

/**
 * The billing consequence of one roster change. Removing always frees the
 * place; adding only grows the group once every declared place is filled
 * (a join-link group filling its places changes nothing).
 */
export function planSeatChange(i: SeatPlanInput): SeatPlan {
  const none = (seatsAfter: number): SeatPlan => ({ seatsAfter, invoice: 'none', additionalSeats: 0 })
  if (i.change.kind === 'removed') {
    const seatsAfter = Math.max(0, i.rosterAfter, i.seatsBefore - 1)
    if (seatsAfter === i.seatsBefore) return none(seatsAfter)
    if (i.mode === 'invoice' && i.invoice === 'open') {
      return { seatsAfter, invoice: seatsAfter > 0 ? 'revise' : 'void', additionalSeats: 0 }
    }
    // Paid groups are refunded by the caller (executeRefund); nothing to invoice.
    return none(seatsAfter)
  }
  const overflow = Math.max(0, i.rosterAfter - i.seatsBefore)
  const seatsAfter = i.seatsBefore + overflow
  if (overflow === 0) return none(seatsAfter)
  if (i.mode === 'invoice') {
    if (i.invoice === 'open') return { seatsAfter, invoice: 'revise', additionalSeats: 0 }
    if (i.invoice === 'paid') return { seatsAfter, invoice: 'additional', additionalSeats: overflow }
    return none(seatsAfter)
  }
  if (i.mode === 'card' && i.cardPaid) return { seatsAfter, invoice: 'additional', additionalSeats: overflow }
  return none(seatsAfter)
}

/** New declared counts after a change, taking places from (or adding to) the person's own bucket first. */
export function adjustCounts(
  counts: { adult: number; student: number },
  bucket: 'student' | 'adult',
  delta: number,
): { adult: number; student: number } {
  const next = { ...counts }
  if (delta >= 0) {
    next[bucket] += delta
    return next
  }
  let left = -delta
  const other = bucket === 'student' ? 'adult' : 'student'
  for (const b of [bucket, other] as const) {
    const take = Math.min(left, next[b])
    next[b] -= take
    left -= take
  }
  return next
}

export interface CouponTerms { percentOff: number | null; amountOffCents: number | null }

/** Subtotal, discount and total for `seats` places, as Stripe will compute them. */
export function invoiceTotals(seats: number, perSeatCents: number, coupon: CouponTerms | null) {
  const subtotal = seats * perSeatCents
  let discount = 0
  if (coupon?.percentOff) discount = Math.round((subtotal * coupon.percentOff) / 100)
  else if (coupon?.amountOffCents) discount = Math.min(subtotal, coupon.amountOffCents)
  return { subtotalCents: subtotal, discountCents: discount, totalCents: subtotal - discount }
}

/**
 * What one place on a paid invoice actually cost, after any discount. A refund
 * is never more than this. Null when the invoice can't say (no seats recorded).
 */
export function perSeatPaidCents(totalPaidCents: number, seats: number): number | null {
  if (!Number.isFinite(seats) || seats <= 0 || totalPaidCents <= 0) return null
  return Math.floor(totalPaidCents / seats)
}

export function formatMoney(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// ── Reads ────────────────────────────────────────────────────────────────────

export async function loadRegistration(db: Db, registrationId: string): Promise<GroupRegistration | null> {
  const { data } = await db.from('registrations').select(REG_COLUMNS).eq('id', registrationId).maybeSingle()
  return (data as unknown as GroupRegistration | null) ?? null
}

export async function ledgerFor(db: Db, registrationId: string): Promise<GroupInvoiceRow[]> {
  const { data } = await db
    .from('group_invoices')
    .select('*')
    .eq('registration_id', registrationId)
    .order('created_at', { ascending: true })
  return (data ?? []) as GroupInvoiceRow[]
}

export async function rosterCount(db: Db, registrationId: string): Promise<number> {
  const { count } = await db
    .from('participants')
    .select('id', { count: 'exact', head: true })
    .eq('registration_id', registrationId)
  return count ?? 0
}

/** The event's per-place list price, from its Stripe Price. */
export async function eventSeatPrice(stripe: Stripe, eventSlug: string): Promise<{ unitCents: number; currency: string } | null> {
  const event = (await getEventBySlug(eventSlug).catch(() => null)) as { stripePriceId?: string } | null
  if (!event?.stripePriceId) return null
  try {
    const price = await stripe.prices.retrieve(event.stripePriceId)
    return { unitCents: price.unit_amount ?? 0, currency: price.currency ?? 'usd' }
  } catch (e) {
    console.error('[group-billing] price lookup failed:', e)
    return null
  }
}

function invoiceStatus(inv: Stripe.Invoice): LedgerStatus {
  return (inv.status ?? 'draft') as LedgerStatus
}

function discountCents(inv: Stripe.Invoice): number {
  return (inv.total_discount_amounts ?? []).reduce((s, d) => s + (d.amount ?? 0), 0)
}

/** The payment intent that settled an invoice (API 2025-03-31.basil+: via invoice.payments). */
export async function invoicePaymentIntent(stripe: Stripe, invoiceId: string): Promise<string | null> {
  try {
    const inv = await stripe.invoices.retrieve(invoiceId, { expand: ['payments'] })
    const payments = (inv as Stripe.Invoice & { payments?: { data?: Array<{ status?: string; payment?: { payment_intent?: string | { id: string } | null } }> } }).payments?.data ?? []
    const paid = payments.find((p) => p.status === 'paid') ?? payments[0]
    const pi = paid?.payment?.payment_intent
    return typeof pi === 'string' ? pi : pi?.id ?? null
  } catch (e) {
    console.error('[group-billing] invoice payment lookup failed:', e)
    return null
  }
}

async function upsertLedger(db: Db, row: Partial<GroupInvoiceRow> & { stripe_invoice_id: string }) {
  const { error } = await db.from('group_invoices').upsert(row, { onConflict: 'stripe_invoice_id' })
  if (error) console.error('[group-billing] ledger write failed:', error.message, { invoice: row.stripe_invoice_id })
}

function ledgerRowFromInvoice(
  inv: Stripe.Invoice,
  base: { registrationId: string; eventSlug: string; kind: 'seats' | 'additional'; seats: number; perSeatCents: number },
): Partial<GroupInvoiceRow> & { stripe_invoice_id: string } {
  return {
    registration_id: base.registrationId,
    event_slug: base.eventSlug,
    stripe_invoice_id: inv.id as string,
    stripe_invoice_number: inv.number ?? null,
    kind: base.kind,
    status: invoiceStatus(inv),
    seats: base.seats,
    per_seat_cents: base.perSeatCents,
    subtotal_cents: inv.subtotal ?? 0,
    discount_cents: discountCents(inv),
    total_cents: inv.total ?? 0,
    currency: inv.currency ?? 'usd',
  }
}

/**
 * The group's main invoice as Stripe has it now, adopting a pre-ledger invoice
 * (found by metadata search) into the ledger the first time it is seen. Follows
 * Stripe's revision chain, so a revision made in the Dashboard is picked up.
 */
export async function currentSeatsInvoice(
  db: Db,
  stripe: Stripe,
  reg: GroupRegistration,
): Promise<{ invoice: Stripe.Invoice; row: GroupInvoiceRow | null } | null> {
  const ledger = await ledgerFor(db, reg.id)
  const latest = [...ledger].reverse().find((r) => r.kind === 'seats' && r.status !== 'void')
    ?? [...ledger].reverse().find((r) => r.kind === 'seats')
  let invoice: Stripe.Invoice | null = null
  if (latest) {
    invoice = await stripe.invoices.retrieve(latest.stripe_invoice_id)
  } else {
    const found = await stripe.invoices.search({
      query: `metadata['registrationId']:'${reg.id.replace(/'/g, '')}'`,
      limit: 20,
    })
    // Main invoice only (not an "additional" one), never a draft revision.
    const candidates = found.data.filter((inv) => inv.metadata?.kind !== 'additional' && inv.status !== 'draft')
    invoice = candidates.find((inv) => inv.status !== 'void') ?? candidates[0] ?? null
    if (!invoice) return null
  }
  // A revised invoice is void and points at its latest revision.
  for (let hops = 0; invoice.status === 'void' && invoice.latest_revision && hops < 10; hops++) {
    const next = typeof invoice.latest_revision === 'string' ? invoice.latest_revision : invoice.latest_revision.id
    invoice = await stripe.invoices.retrieve(next)
  }
  let row = ledger.find((r) => r.stripe_invoice_id === invoice!.id) ?? null
  if (!row) {
    // Pre-ledger invoice: one line for the whole group. Its seats are the
    // declared size and its per-place price is what it charged per place.
    const seats = Number(invoice.metadata?.seats) || (reg.adult_count ?? 0) + (reg.student_count ?? 0)
    const perSeat = Number(invoice.metadata?.perSeatCents) || (seats > 0 ? Math.round((invoice.subtotal ?? 0) / seats) : 0)
    await upsertLedger(db, {
      ...ledgerRowFromInvoice(invoice, { registrationId: reg.id, eventSlug: reg.event_slug, kind: 'seats', seats, perSeatCents: perSeat }),
      reason: 'Group registration',
    })
    row = (await ledgerFor(db, reg.id)).find((r) => r.stripe_invoice_id === invoice!.id) ?? null
  } else if (row.status !== invoiceStatus(invoice)) {
    await db.from('group_invoices').update({ status: invoiceStatus(invoice) }).eq('id', row.id)
    row = { ...row, status: invoiceStatus(invoice) }
  }
  return { invoice, row }
}

// ── Writes ───────────────────────────────────────────────────────────────────

export interface Actor { memberId: string | null; label: string }

interface InvoiceSpec {
  reg: GroupRegistration
  customerId: string
  seats: number
  perSeatCents: number
  currency: string
  reason: string
  actor: Actor
  couponId: string | null
  kind: 'seats' | 'additional'
  participantIds?: string[]
}

function lineDescription(eventTitle: string, kind: 'seats' | 'additional') {
  return kind === 'additional'
    ? `${eventTitle} — Additional participant registration (per participant)`
    : `${eventTitle} — Group Registration (per participant)`
}

function metadataFor(spec: InvoiceSpec, extra: Record<string, string> = {}): Record<string, string> {
  return {
    registrationId: spec.reg.id,
    eventSlug: spec.reg.event_slug,
    isGroup: 'true',
    kind: spec.kind,
    seats: String(spec.seats),
    perSeatCents: String(spec.perSeatCents),
    ...(spec.participantIds?.length ? { participantIds: spec.participantIds.join(',').slice(0, 480) } : {}),
    ...extra,
  }
}

async function finishAndRecord(db: Db, stripe: Stripe, draftId: string, spec: InvoiceSpec, replaces: string | null) {
  const finalized = await stripe.invoices.finalizeInvoice(draftId)
  const sent = await stripe.invoices.sendInvoice(finalized.id as string)
  await upsertLedger(db, {
    ...ledgerRowFromInvoice(sent, { registrationId: spec.reg.id, eventSlug: spec.reg.event_slug, kind: spec.kind, seats: spec.seats, perSeatCents: spec.perSeatCents }),
    coupon_id: spec.couponId,
    promotion_code: spec.couponId ? spec.reg.invoice_promotion_code : null,
    replaces_stripe_invoice_id: replaces,
    reason: spec.reason,
    participant_ids: spec.participantIds ?? [],
    created_by: spec.actor.memberId,
  })
  if (replaces) {
    await db.from('group_invoices')
      .update({ status: 'void', voided_at: new Date().toISOString() })
      .eq('stripe_invoice_id', replaces)
  }
  return sent
}

/** A fresh invoice: the group's first, or one for places added after payment. */
export async function createGroupInvoice(db: Db, stripe: Stripe, spec: InvoiceSpec): Promise<Stripe.Invoice> {
  // deep review PAY-1: create the invoice FIRST, then attach the line to it
  // explicitly (`invoice: id`) — a pending item is excluded by default on the
  // pinned API version, which once finalised a $0 invoice for a paid event.
  const draft = await stripe.invoices.create({
    customer: spec.customerId,
    collection_method: 'send_invoice',
    days_until_due: 14,
    auto_advance: false,
    metadata: metadataFor(spec),
    // The money-back guarantee, printed on the invoice.
    footer: GUARANTEE_RECEIPT_LINE,
    ...(spec.kind === 'additional' ? { description: spec.reason } : {}),
    ...(spec.couponId ? { discounts: [{ coupon: spec.couponId }] } : {}),
  })
  await stripe.invoiceItems.create({
    customer: spec.customerId,
    invoice: draft.id as string,
    currency: spec.currency,
    quantity: spec.seats,
    unit_amount_decimal: Stripe.Decimal.from(spec.perSeatCents),
    description: lineDescription(spec.reg.event_title, spec.kind),
  })
  return finishAndRecord(db, stripe, draft.id as string, spec, null)
}

/**
 * Revises an open invoice to `spec.seats` places with Stripe's own revision:
 * finalising the revision voids the original, and the organiser is emailed
 * the new one. Reuses a draft revision someone started in the Dashboard
 * (Stripe allows only one).
 */
export async function reviseGroupInvoice(db: Db, stripe: Stripe, original: Stripe.Invoice, spec: InvoiceSpec): Promise<Stripe.Invoice> {
  let draft: Stripe.Invoice
  try {
    draft = await stripe.invoices.create({ from_invoice: { action: 'revision', invoice: original.id as string } })
  } catch (e) {
    const customer = typeof original.customer === 'string' ? original.customer : original.customer?.id
    const drafts = customer ? await stripe.invoices.list({ customer, status: 'draft', limit: 50 }) : { data: [] as Stripe.Invoice[] }
    const existing = drafts.data.find((d) => d.from_invoice?.invoice === original.id
      || (typeof d.from_invoice?.invoice === 'object' && d.from_invoice?.invoice?.id === original.id))
    if (!existing) throw e
    draft = existing
  }
  // Replace the copied line(s) with one per-place line at the new size.
  const lines = draft.lines?.data ?? []
  if (lines.length > 0) {
    await stripe.invoices.removeLines(draft.id as string, {
      lines: lines.map((l) => ({ id: l.id as string, behavior: 'delete' as const })),
    })
  }
  await stripe.invoiceItems.create({
    customer: spec.customerId,
    invoice: draft.id as string,
    currency: spec.currency,
    quantity: spec.seats,
    unit_amount_decimal: Stripe.Decimal.from(spec.perSeatCents),
    description: lineDescription(spec.reg.event_title, spec.kind),
  })
  await stripe.invoices.update(draft.id as string, {
    metadata: metadataFor(spec, { replaces: original.id as string }),
    description: `${spec.reason}. This replaces invoice ${original.number ?? original.id}, which is now cancelled.`,
    discounts: spec.couponId ? [{ coupon: spec.couponId }] : '',
    footer: GUARANTEE_RECEIPT_LINE,
  })
  return finishAndRecord(db, stripe, draft.id as string, spec, original.id as string)
}

async function voidGroupInvoice(db: Db, stripe: Stripe, invoice: Stripe.Invoice, reason: string) {
  const voided = await stripe.invoices.voidInvoice(invoice.id as string)
  await db.from('group_invoices')
    .update({ status: 'void', voided_at: new Date().toISOString(), reason })
    .eq('stripe_invoice_id', voided.id as string)
}

/** The customer the group's invoices go to: the main invoice's, else the organiser's. */
async function invoiceCustomer(db: Db, stripe: Stripe, reg: GroupRegistration, current: Stripe.Invoice | null): Promise<string> {
  const fromInvoice = current ? (typeof current.customer === 'string' ? current.customer : current.customer?.id) : null
  if (fromInvoice) return fromInvoice
  if (reg.teacher_member_id) {
    const { data } = await db.from('members').select('stripe_customer_id').eq('id', reg.teacher_member_id).maybeSingle()
    const id = (data as { stripe_customer_id?: string | null } | null)?.stripe_customer_id
    if (id) return id
  }
  const customer = await stripe.customers.create({
    email: reg.teacher_email ?? undefined,
    name: [reg.teacher_first_name, reg.teacher_last_name].filter(Boolean).join(' ') || undefined,
    metadata: { registrationId: reg.id, eventSlug: reg.event_slug },
  })
  if (reg.teacher_member_id) {
    await db.from('members').update({ stripe_customer_id: customer.id }).eq('id', reg.teacher_member_id).is('stripe_customer_id', null)
  }
  return customer.id
}

async function couponTerms(stripe: Stripe, couponId: string | null): Promise<CouponTerms | null> {
  if (!couponId) return null
  try {
    const c = await stripe.coupons.retrieve(couponId)
    return { percentOff: c.percent_off ?? null, amountOffCents: c.amount_off ?? null }
  } catch {
    return null
  }
}

// ── Roster changes ───────────────────────────────────────────────────────────

export interface BillingOutcome {
  /** One sentence for the organiser (or admin) about what happened to the money. */
  message: string | null
  action: 'revised' | 'voided' | 'additional' | 'none' | 'failed'
  seatsAfter: number
  invoiceId?: string
}

async function writeCounts(db: Db, reg: GroupRegistration, counts: { adult: number; student: number }, perSeat: number | null) {
  const seats = counts.adult + counts.student
  const update: Record<string, unknown> = { adult_count: counts.adult, student_count: counts.student }
  if (perSeat != null && perSeat > 0) update.amount_due_cents = seats * perSeat
  const { error } = await db.from('registrations').update(update).eq('id', reg.id)
  if (error) console.error('[group-billing] seat count update failed:', error.message, { registrationId: reg.id })
}

async function alertStaff(body: string) {
  // Lazy: lib/notify reaches Clerk, which the pure tests never load.
  const { notifyCommunityAdmins } = await import('@/lib/notify')
  await notifyCommunityAdmins({ type: 'action', body }).catch(() => {})
}

/**
 * Applies one roster change to a group's places and invoices. Call AFTER the
 * participant row is inserted or deleted (rosterAfter is read from the table).
 * A paid place that was removed is refunded separately, through executeRefund,
 * BEFORE the row goes. Never throws: a Stripe failure alerts staff and reports
 * 'failed', because the roster change itself has already happened.
 */
export async function applyRosterChange(
  db: Db,
  stripe: Stripe | null,
  input: {
    registrationId: string
    change: SeatChange
    /** The role of the person removed or added, to pick adult vs student places. */
    eventRole: string | null
    /** Several people added at once (a sheet sync): their roles, for the same split. */
    addedRoles?: (string | null)[]
    participantIds?: string[]
    actor: Actor
  },
): Promise<BillingOutcome> {
  const reg = await loadRegistration(db, input.registrationId)
  if (!reg || reg.type !== 'group' || reg.status === 'withdrawn') {
    return { message: null, action: 'none', seatsAfter: 0 }
  }
  const counts = { adult: reg.adult_count ?? 0, student: reg.student_count ?? 0 }
  const seatsBefore = counts.adult + counts.student
  // Registrations from before migration 037 have no declared size: nothing to track.
  if (reg.adult_count == null || reg.student_count == null) return { message: null, action: 'none', seatsAfter: seatsBefore }

  const mode = billingMode(reg)
  const rosterAfter = await rosterCount(db, reg.id)

  let current: { invoice: Stripe.Invoice; row: GroupInvoiceRow | null } | null = null
  if (mode === 'invoice' && stripe) {
    try {
      current = await currentSeatsInvoice(db, stripe, reg)
    } catch (e) {
      console.error('[group-billing] could not read the group invoice:', e)
    }
  }
  const invoiceState: SeatPlanInput['invoice'] =
    current?.invoice.status === 'open' ? 'open'
      : current?.invoice.status === 'paid' || reg.invoice_paid_at ? 'paid'
        : 'none'

  const plan = planSeatChange({
    mode,
    seatsBefore,
    rosterAfter,
    change: input.change,
    invoice: invoiceState,
    cardPaid: !!reg.stripe_payment_intent_id,
  })
  const delta = plan.seatsAfter - seatsBefore
  let nextCounts = adjustCounts(counts, seatBucket(input.eventRole), delta)
  if (delta > 0 && input.addedRoles?.length) {
    // New places go to students first, as many as were added, then adults.
    const students = input.addedRoles.filter((r) => seatBucket(r) === 'student').length
    const toStudents = Math.min(delta, students)
    nextCounts = adjustCounts(adjustCounts(counts, 'student', toStudents), 'adult', delta - toStudents)
  }

  const perSeat = current?.row?.per_seat_cents
    || (stripe ? (await eventSeatPrice(stripe, reg.event_slug))?.unitCents : null)
    || null
  if (delta !== 0) await writeCounts(db, reg, nextCounts, perSeat)

  // Reasons reach the invoice the organiser receives, so they never name a
  // student: the organiser knows who they removed.
  const sizeLine = `${plural(seatsBefore, 'participant')} → ${plural(plan.seatsAfter, 'participant')}`
  const why = input.change.kind === 'removed'
    ? 'a participant was removed'
    : `${plural(input.change.count, 'participant')} ${input.change.count === 1 ? 'was' : 'were'} added`

  if (plan.invoice === 'none' || !stripe) {
    const message = delta === 0 ? null
      : `Your group is now ${plural(plan.seatsAfter, 'participant')}.`
    return { message, action: 'none', seatsAfter: plan.seatsAfter }
  }

  try {
    if (plan.invoice === 'void' && current) {
      await voidGroupInvoice(db, stripe, current.invoice, `Cancelled: ${why} and no participants are left to pay for`)
      return { message: 'Your invoice has been cancelled: there are no participants left to pay for.', action: 'voided', seatsAfter: 0, invoiceId: current.invoice.id as string }
    }

    const price = perSeat ?? 0
    const currency = current?.invoice.currency ?? (await eventSeatPrice(stripe, reg.event_slug))?.currency ?? 'usd'
    if (price <= 0) throw new Error('No per-place price for this event')
    const customerId = await invoiceCustomer(db, stripe, reg, current?.invoice ?? null)

    if (plan.invoice === 'revise' && current) {
      const spec: InvoiceSpec = {
        reg, customerId, seats: plan.seatsAfter, perSeatCents: price, currency,
        reason: `Updated to ${plural(plan.seatsAfter, 'participant')} after ${why} (was ${seatsBefore})`,
        actor: input.actor, couponId: reg.invoice_coupon_id, kind: 'seats',
      }
      const sent = await reviseGroupInvoice(db, stripe, current.invoice, spec)
      return {
        message: `We've emailed ${reg.teacher_email ?? 'you'} an updated invoice for ${plural(plan.seatsAfter, 'participant')} (${formatMoney(sent.total ?? 0, currency)}). The previous invoice is cancelled.`,
        action: 'revised', seatsAfter: plan.seatsAfter, invoiceId: sent.id as string,
      }
    }

    if (plan.invoice === 'additional') {
      // A percentage discount carries to extra places; a fixed amount was the group's, once.
      const terms = await couponTerms(stripe, reg.invoice_coupon_id)
      const spec: InvoiceSpec = {
        reg, customerId, seats: plan.additionalSeats, perSeatCents: price, currency,
        reason: `${plural(plan.additionalSeats, 'additional participant')}, added after the group's invoice was paid (group is now ${plan.seatsAfter})`,
        actor: input.actor, couponId: terms?.percentOff ? reg.invoice_coupon_id : null, kind: 'additional',
        participantIds: input.participantIds,
      }
      const sent = await createGroupInvoice(db, stripe, spec)
      return {
        message: `We've emailed ${reg.teacher_email ?? 'you'} an invoice for ${plural(plan.additionalSeats, 'additional participant')} (${formatMoney(sent.total ?? 0, currency)}).`,
        action: 'additional', seatsAfter: plan.seatsAfter, invoiceId: sent.id as string,
      }
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    console.error('[group-billing] invoice update failed:', detail, { registrationId: reg.id })
    await alertStaff(
      `The invoice for the ${reg.event_title} group registered by ${reg.teacher_email ?? 'an organiser'} could not be updated after a roster change (${sizeLine}): ${detail}. Open the event roster → the group → "Invoice & discount…" to reissue it.`,
    )
    return {
      message: `Your group is now ${plural(plan.seatsAfter, 'participant')}. We couldn't update your invoice automatically, so our team has been alerted and will send you a corrected one.`,
      action: 'failed', seatsAfter: plan.seatsAfter,
    }
  }
  return { message: null, action: 'none', seatsAfter: plan.seatsAfter }
}

// ── Admin: discount and reissue ──────────────────────────────────────────────

export interface ResolvedDiscount { couponId: string; code: string; label: string; terms: CouponTerms }

/** A promotion code (e.g. "STEMCAREERS") or a coupon id, resolved to its coupon. */
export async function resolveDiscountCode(stripe: Stripe, raw: string): Promise<ResolvedDiscount | null> {
  const code = raw.trim()
  if (!code) return null
  const promos = await stripe.promotionCodes.list({ code, active: true, limit: 1 })
  const promo = promos.data[0]
  let couponId: string | null = null
  if (promo) {
    const p = promo as Stripe.PromotionCode & { promotion?: { coupon?: string | { id: string } | null }; coupon?: string | { id: string } }
    const ref = p.promotion?.coupon ?? p.coupon ?? null
    couponId = typeof ref === 'string' ? ref : ref?.id ?? null
  }
  if (!couponId) {
    try {
      couponId = (await stripe.coupons.retrieve(code)).id
    } catch {
      return null
    }
  }
  const coupon = await stripe.coupons.retrieve(couponId)
  if (!coupon.valid) return null
  const terms = { percentOff: coupon.percent_off ?? null, amountOffCents: coupon.amount_off ?? null }
  const off = terms.percentOff ? `${terms.percentOff}% off` : terms.amountOffCents ? `${formatMoney(terms.amountOffCents, coupon.currency ?? 'usd')} off` : 'discount'
  return { couponId, code: promo?.code ?? code, label: `${promo?.code ?? coupon.name ?? code} (${off})`, terms }
}

export interface GroupInvoiceSummary {
  mode: GroupBillingMode
  seats: number
  roster: number
  perSeatCents: number | null
  currency: string
  discount: { code: string | null; couponId: string } | null
  current: {
    id: string; number: string | null; status: string; totalCents: number; hostedUrl: string | null
  } | null
  history: GroupInvoiceRow[]
}

export async function groupInvoiceSummary(db: Db, stripe: Stripe | null, registrationId: string): Promise<GroupInvoiceSummary | null> {
  const reg = await loadRegistration(db, registrationId)
  if (!reg || reg.type !== 'group') return null
  const current = stripe && reg.invoice_requested ? await currentSeatsInvoice(db, stripe, reg).catch(() => null) : null
  const price = current?.row?.per_seat_cents ?? (stripe ? (await eventSeatPrice(stripe, reg.event_slug))?.unitCents ?? null : null)
  return {
    mode: billingMode(reg),
    seats: (reg.adult_count ?? 0) + (reg.student_count ?? 0),
    roster: await rosterCount(db, reg.id),
    perSeatCents: price,
    currency: current?.invoice.currency ?? 'usd',
    discount: reg.invoice_coupon_id ? { code: reg.invoice_promotion_code, couponId: reg.invoice_coupon_id } : null,
    current: current
      ? {
          id: current.invoice.id as string,
          number: current.invoice.number ?? null,
          status: current.invoice.status ?? 'draft',
          totalCents: current.invoice.total ?? 0,
          hostedUrl: current.invoice.hosted_invoice_url ?? null,
        }
      : null,
    history: await ledgerFor(db, reg.id),
  }
}

/**
 * Applies (or, with null, removes) a discount on a group's invoices and
 * reissues the open invoice at the group's current size. Only an unpaid
 * invoice can be changed; a paid one is refused with a reason.
 */
export async function setGroupDiscount(
  db: Db,
  stripe: Stripe,
  registrationId: string,
  discount: ResolvedDiscount | null,
  actor: Actor,
): Promise<{ ok: true; message: string; invoiceId: string } | { ok: false; error: string }> {
  const reg = await loadRegistration(db, registrationId)
  if (!reg || reg.type !== 'group') return { ok: false, error: 'Group registration not found' }
  if (!reg.invoice_requested) return { ok: false, error: 'This group is not paying by invoice.' }
  if (reg.invoice_paid_at) return { ok: false, error: 'This invoice has already been paid, so it can no longer be changed. Refund the difference in Stripe if a discount was owed.' }
  const current = await currentSeatsInvoice(db, stripe, reg)
  if (!current) return { ok: false, error: 'No invoice has been sent yet. Use "Finish setup…" to send it first.' }
  if (current.invoice.status !== 'open') return { ok: false, error: `The invoice is ${current.invoice.status}, so it can't be revised.` }

  const { error } = await db.from('registrations')
    .update({ invoice_coupon_id: discount?.couponId ?? null, invoice_promotion_code: discount?.code ?? null })
    .eq('id', reg.id)
  if (error) return { ok: false, error: 'Could not save the discount.' }

  const seats = (reg.adult_count ?? 0) + (reg.student_count ?? 0) || current.row?.seats || 0
  const perSeat = current.row?.per_seat_cents || (await eventSeatPrice(stripe, reg.event_slug))?.unitCents || 0
  if (seats <= 0 || perSeat <= 0) return { ok: false, error: 'Could not work out the group size or price.' }
  const customerId = await invoiceCustomer(db, stripe, reg, current.invoice)
  const sent = await reviseGroupInvoice(db, stripe, current.invoice, {
    reg: { ...reg, invoice_coupon_id: discount?.couponId ?? null, invoice_promotion_code: discount?.code ?? null },
    customerId, seats, perSeatCents: perSeat, currency: current.invoice.currency ?? 'usd',
    reason: discount ? `Discount ${discount.label} applied` : 'Discount removed',
    actor, couponId: discount?.couponId ?? null, kind: 'seats',
  })
  return {
    ok: true,
    invoiceId: sent.id as string,
    message: `Sent ${reg.teacher_email ?? 'the organiser'} a revised invoice for ${plural(seats, 'participant')}: ${formatMoney(sent.total ?? 0, sent.currency ?? 'usd')}${discount ? ` after ${discount.label}` : ''}.`,
  }
}

/** Voids every unpaid invoice of a group that is being withdrawn or deleted. */
export async function voidOpenGroupInvoices(db: Db, stripe: Stripe | null, registrationId: string, reason: string): Promise<number> {
  if (!stripe) return 0
  const reg = await loadRegistration(db, registrationId)
  if (!reg || reg.type !== 'group' || !reg.invoice_requested) return 0
  let voided = 0
  try {
    const current = await currentSeatsInvoice(db, stripe, reg)
    const open = new Map<string, Stripe.Invoice>()
    if (current?.invoice.status === 'open') open.set(current.invoice.id as string, current.invoice)
    for (const row of await ledgerFor(db, reg.id)) {
      if (row.status === 'open' && !open.has(row.stripe_invoice_id)) {
        const inv = await stripe.invoices.retrieve(row.stripe_invoice_id)
        if (inv.status === 'open') open.set(inv.id as string, inv)
      }
    }
    for (const inv of open.values()) {
      await voidGroupInvoice(db, stripe, inv, reason)
      voided++
    }
  } catch (e) {
    console.error('[group-billing] voiding open invoices failed:', e)
    await alertStaff(`An unpaid invoice for the withdrawn ${reg.event_title} group (${reg.teacher_email ?? 'organiser unknown'}) could not be cancelled automatically. Void it in Stripe.`)
  }
  return voided
}

// ── Webhook: invoice.paid ────────────────────────────────────────────────────

/**
 * Records a paid group invoice: ledger status, and the payment intent where a
 * later refund will look for it (the registration for the main invoice, each
 * covered participant for an "additional" one). Returns the invoice kind so
 * the webhook confirms the registration only for the main invoice.
 */
export async function recordGroupInvoicePaid(db: Db, stripe: Stripe, invoice: Stripe.Invoice): Promise<'seats' | 'additional'> {
  const registrationId = invoice.metadata?.registrationId
  const kind: 'seats' | 'additional' = invoice.metadata?.kind === 'additional' ? 'additional' : 'seats'
  if (!registrationId) return kind
  const paymentIntent = await invoicePaymentIntent(stripe, invoice.id as string)
  const { data: existing } = await db.from('group_invoices').select('id, participant_ids, seats').eq('stripe_invoice_id', invoice.id as string).maybeSingle()
  const row = existing as { id: string; participant_ids: string[] | null; seats: number } | null
  const paidAt = invoice.status_transitions?.paid_at ? new Date(invoice.status_transitions.paid_at * 1000).toISOString() : new Date().toISOString()
  if (row) {
    await db.from('group_invoices').update({ status: 'paid', paid_at: paidAt, payment_intent_id: paymentIntent }).eq('id', row.id)
  } else {
    const seats = Number(invoice.metadata?.seats) || 0
    await upsertLedger(db, {
      ...ledgerRowFromInvoice(invoice, {
        registrationId, eventSlug: invoice.metadata?.eventSlug ?? '', kind,
        seats, perSeatCents: Number(invoice.metadata?.perSeatCents) || (seats > 0 ? Math.round((invoice.subtotal ?? 0) / seats) : 0),
      }),
      status: 'paid', paid_at: paidAt, payment_intent_id: paymentIntent, reason: 'Group registration',
    })
  }
  if (!paymentIntent) return kind // paid outside Stripe (e.g. a cheque marked paid): nothing to refund against
  if (kind === 'seats') {
    await db.from('registrations').update({ stripe_payment_intent_id: paymentIntent })
      .eq('id', registrationId).is('stripe_payment_intent_id', null)
  } else {
    const ids = row?.participant_ids?.length ? row.participant_ids
      : (invoice.metadata?.participantIds ?? '').split(',').filter(Boolean)
    if (ids.length > 0) {
      await db.from('participants').update({ stripe_payment_intent_id: paymentIntent })
        .in('id', ids).eq('registration_id', registrationId).is('stripe_payment_intent_id', null)
    }
  }
  return kind
}

// ── What to tell the person who made the change ──────────────────────────────

/** One or two sentences about the money after a removal: the refund (if any), then the invoice. */
export function describeRemoval(
  refund: { type: 'cash' | 'manual_required' | 'none'; refundCents: number; detail: string } | null,
  billing: BillingOutcome | null,
  currency = 'usd',
): string | null {
  const parts: string[] = []
  if (refund?.type === 'cash') {
    parts.push(`A ${formatMoney(refund.refundCents, currency)} refund for this place is on its way to the card or account that paid.`)
  } else if (refund?.type === 'manual_required') {
    parts.push('This place was paid for, and our team will process its refund by hand.')
  } else if (refund?.type === 'none' && /outside the \d+-day money-back guarantee/.test(refund.detail)) {
    parts.push('The payment was made more than 45 days ago, so this place is outside our money-back guarantee and no refund was issued. Reply to your confirmation email if you think that is wrong.')
  }
  if (billing?.message) parts.push(billing.message)
  return parts.length ? parts.join(' ') : null
}
