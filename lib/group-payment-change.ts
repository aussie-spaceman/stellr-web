import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { rowTenant, TENANT_PAYMENTS_UNAVAILABLE } from '@/lib/registration/event-context'
import {
  alertStaff,
  billableSeats,
  billingMode,
  couponTerms,
  createGroupInvoice,
  currentSeatsInvoice,
  eventSeatPrice,
  formatMoney,
  invoiceCustomer,
  invoiceTotals,
  ledgerFor,
  loadRegistration,
  markInvoiceSyncDue,
  queueInvoiceSync,
  seatBucket,
  voidGroupInvoice,
  withInvoiceLock,
  type CouponTerms,
  type GroupBillingMode,
  type GroupRegistration,
} from '@/lib/group-billing'
import { ensureIndividualPayments, type IndividualPaymentPerson } from '@/lib/individual-payment'
import { ensurePayToken, payPageUrl } from '@/lib/registration-checkout'
import { sendPayLinkEmail } from '@/lib/registration-pay-link'
import { groupPaymentMethodChangedEmail, groupSeatPaymentNoLongerDueEmail, sendEmail } from '@/lib/email'
import { refreshShare, shareFor, summarise, loadShareGroup, unwindShares, type ShareSummary } from '@/lib/teacher-share'
import {
  isAdultRole,
  isLateJoinerPayer,
  isSharedGroup,
  isSplitGroup,
  payerOf,
  seatsOnInvoice,
  type LateJoinerPayer,
  type Payer,
} from '@/lib/group-payer'

// Changing how a group pays after it has registered (6 Nov 2026). A teacher who
// chose an invoice asked for each person to pay instead, and nothing could do it.
//
// This moves a group between the three ways the registration form already offers;
// it adds none. Only the unpaid balance moves: places paid individually stay paid,
// and a group whose own payment has been taken can't be changed (refunds are a
// separate tool).
//
// Order matters, because the failure to avoid is one group holding two live ways
// to pay. Everything payable under the old method is closed first (open Checkout
// sessions expired, open invoices voided), and any sign that a payment is already
// on its way stops the change. Only then do the registration's flags move, under
// the same lock that guards the group's invoice, and only then does the new
// method start. A failure at that last step leaves the new method in place and
// alerts staff, who can finish it from the roster.
//
// "Invoice for some" (9 Nov 2026): a teacher asked for an invoice for herself only,
// her students paying by their own links. The organizer's invoice then covers the
// people ticked (participants.payer = 'group'); everyone else pays by link
// ('self'), and late_joiner_payer says how people who join later pay
// (lib/group-payer.ts). Moving people on or off an open invoice revises it after
// the usual quiet period instead of cancelling it, so the organizer gets one
// updated invoice, not a cancellation and a new one.

type Db = SupabaseClient

export type GroupPaymentMethod = Exclude<GroupBillingMode, 'free'> | 'invoice_some' | 'teacher_share'
export type GroupPaymentPlan = GroupPaymentMethod | 'free'

export const PAYMENT_METHODS: GroupPaymentMethod[] = ['invoice', 'invoice_some', 'card', 'individual', 'teacher_share']

export const PAYMENT_METHOD_LABEL: Record<GroupPaymentMethod, string> = {
  invoice: 'Invoice emailed to the organizer',
  invoice_some: 'Invoice for some, the rest pay individually',
  card: 'Credit card, paid by the organizer',
  individual: 'Group members pay individually',
  teacher_share: 'Students pay individually and share the teacher’s cost',
}

/** How the group pays now, including a split ("Invoice for some") group. */
export function paymentPlan(reg: Parameters<typeof billingMode>[0] & { late_joiner_payer?: string | null; share_estimate?: number | null }): GroupPaymentPlan {
  if (reg.type !== 'campaign' && isSharedGroup(reg)) return 'teacher_share'
  if (reg.type !== 'campaign' && isSplitGroup(reg as { member_pays_individually: boolean | null; late_joiner_payer?: string | null }) && reg.invoice_requested) return 'invoice_some'
  return billingMode(reg)
}

/** What a change asks for. The two extra fields only apply to "Invoice for some". */
export interface PaymentChangeRequest {
  method: GroupPaymentMethod
  /** The people whose places go on the organizer's invoice. */
  invoiceParticipantIds?: string[]
  /** How people who join later pay. */
  lateJoinerPayer?: LateJoinerPayer
  /** "Students share the teacher's cost": how many students the teacher expects. */
  shareEstimate?: number
}

/** How far back to look for a Checkout session still open or still settling. Stripe's own limit on an open one is 24 hours. */
const CHECKOUT_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000
const STRIPE_MIN_CHARGE_CENTS = 50

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// ── Pure rules ───────────────────────────────────────────────────────────────

export interface PaymentChangeFacts {
  type: string
  status: string
  mode: GroupBillingMode
  /** How the group pays now: mode, or 'invoice_some' for a split group. */
  plan?: GroupPaymentPlan
  invoicePaid: boolean
  /** The group's own card payment has been taken. */
  cardPaid: boolean
  declaredSeats: number
  paidSeats: number
  perSeatCents: number | null
  currency: string
  coupon: CouponTerms | null
  /** People on the roster who haven't paid, and how many of them have no email address. */
  rosterUnpaid: number
  rosterNoEmail: number
  /** The open invoice the change would cancel, if any. */
  openInvoiceNumber: string | null
  /** Adults (teachers) who haven't paid: whose cost the students would share. */
  unpaidAdults?: number
  /** Students declared, or on the roster if more. */
  students?: number
}

/** Why this group's payment method can't be changed, or null when it can. */
export function changeBlockReason(f: PaymentChangeFacts): string | null {
  if (f.type !== 'group') return 'Only group registrations can change how they pay.'
  if (f.status === 'withdrawn') return 'This registration has been withdrawn, so there is nothing to pay.'
  if (f.mode === 'free') return 'This group has no fee to pay.'
  if (f.invoicePaid) return 'This group’s invoice has been paid, so there is no balance to move. Any refund is handled separately.'
  if (f.cardPaid) return 'This group has paid by card, so there is no balance to move. Any refund is handled separately.'
  if (f.declaredSeats <= 0) return 'This group has no places to pay for.'
  if (billableSeats(f.declaredSeats, f.paidSeats) <= 0) return 'Everyone in this group has paid, so there is no balance to move.'
  if (!f.perSeatCents || f.perSeatCents <= 0) return 'We can’t read this event’s fee right now, so the payment method can’t be changed. Try again shortly.'
  return null
}

export interface PaymentChangeOption {
  method: GroupPaymentMethod
  label: string
  /** What choosing this does, in the order it happens. */
  effects: string[]
  /** Set when this method can't take the balance, e.g. a total below Stripe's minimum. */
  unavailable: string | null
}

/** What moving to `to` would do. The dialog shows this before anything changes. */
export function describeChange(f: PaymentChangeFacts, to: GroupPaymentMethod): PaymentChangeOption {
  const owed = billableSeats(f.declaredSeats, f.paidSeats)
  const perSeat = f.perSeatCents ?? 0
  const { totalCents } = invoiceTotals(owed, perSeat, f.coupon)
  const money = (cents: number) => formatMoney(cents, f.currency)
  const effects: string[] = []

  // An open invoice that stays an invoice is updated rather than cancelled.
  const revises = f.mode === 'invoice' && !!f.openInvoiceNumber && (to === 'invoice' || to === 'invoice_some')
  if (f.plan === 'teacher_share') {
    if (to === 'teacher_share') {
      effects.push('Only the estimate changes. Once a student has paid, it can go up but not down, so the share never rises.')
    } else {
      effects.push('Every share of the teacher’s cost already paid is refunded to whoever paid it.')
      if (to === 'invoice' || to === 'card') effects.push('Students’ payment links stop working, and anyone who received one is told nothing is due.')
    }
  } else if (revises) {
    effects.push(`Invoice ${f.openInvoiceNumber} is replaced by an updated one a couple of minutes after you confirm.`)
  } else if (f.mode === 'invoice') {
    effects.push(f.openInvoiceNumber ? `Invoice ${f.openInvoiceNumber} is cancelled.` : 'Any unpaid invoice is cancelled.')
  } else if (f.mode === 'individual') {
    effects.push('Payment links already sent stop working, and anyone who received one is told nothing is due.')
  } else if (f.mode === 'card') {
    effects.push('Any card payment page already open stops working.')
  }

  let unavailable: string | null = null
  if (to === 'teacher_share') {
    const pool = (f.unpaidAdults ?? 0) * perSeat
    const students = Math.max(1, f.students ?? 0)
    effects.push(`Teachers pay nothing directly. Each student’s link includes an equal share of the teachers’ full price (${money(pool)} in all), split across the larger of your estimate and the students who join: about ${money(shareFor({ poolCents: pool, estimate: students, students }))} each for ${plural(students, 'student')}.`)
    effects.push('Discount codes apply to a student’s own place, never to the share.')
    effects.push('The share can only go down. If more students join after some have paid, the difference goes back to them the day after the event. Anything the shares don’t cover, Stellr covers.')
    if (f.plan !== 'teacher_share') effects.push('Students are emailed a payment link if they don’t have one already.')
    if ((f.unpaidAdults ?? 0) <= 0) unavailable = 'Every adult in this group has already paid, so there is no teacher’s cost to share.'
    else if ((f.students ?? 0) <= 0) unavailable = 'This group has no students to share the cost.'
  } else if (to === 'invoice_some') {
    const perPerson = f.coupon?.percentOff ? invoiceTotals(1, perSeat, f.coupon).totalCents : perSeat
    effects.push(revises
      ? 'The updated invoice covers only the places you tick.'
      : 'The organizer is emailed an invoice for the places you tick, due in 14 days.')
    effects.push(`Everyone else is emailed a link to pay ${money(perPerson)} for their own place. Links already sent keep working.`)
    if (f.rosterNoEmail > 0) effects.push(`${plural(f.rosterNoEmail, 'person').replace('persons', 'people')} on the roster ${f.rosterNoEmail === 1 ? 'has' : 'have'} no email address and won’t get a link until one is added.`)
  } else if (to === 'invoice') {
    effects.push(revises
      ? `The updated invoice covers ${plural(owed, 'place')}: ${money(totalCents)}.`
      : `The organizer is emailed a new invoice for ${plural(owed, 'place')}: ${money(totalCents)}, due in 14 days.`)
    if (totalCents <= 0) unavailable = 'The total for this group is $0.00, so no invoice can be sent.'
  } else if (to === 'card') {
    effects.push(`The organizer is emailed a link to pay ${money(totalCents)} by card for ${plural(owed, 'place')}.`)
    if (totalCents < STRIPE_MIN_CHARGE_CENTS) unavailable = `The total for this group (${money(totalCents)}) is below the $0.50 card minimum.`
  } else {
    const perPerson = f.coupon?.percentOff ? invoiceTotals(1, perSeat, f.coupon).totalCents : perSeat
    effects.push(f.rosterUnpaid > 0
      ? `${plural(f.rosterUnpaid, 'person').replace('persons', 'people')} on the roster ${f.rosterUnpaid === 1 ? 'is' : 'are'} emailed a link to pay ${money(perPerson)}. Anyone added later gets one when they join.`
      : `Each person is emailed a link to pay ${money(perPerson)} when they join the group.`)
    if (f.coupon?.amountOffCents) effects.push('The group’s fixed-amount discount can’t be split per person, so it won’t apply.')
    if (f.rosterNoEmail > 0) effects.push(`${plural(f.rosterNoEmail, 'person').replace('persons', 'people')} on the roster ${f.rosterNoEmail === 1 ? 'has' : 'have'} no email address and won’t get a link until one is added.`)
    if (perPerson < STRIPE_MIN_CHARGE_CENTS) unavailable = `The amount per person (${money(perPerson)}) is below the $0.50 card minimum.`
  }
  if (f.paidSeats > 0) effects.push(`${plural(f.paidSeats, 'place')} already paid individually ${f.paidSeats === 1 ? 'stays' : 'stay'} paid.`)

  return { method: to, label: PAYMENT_METHOD_LABEL[to], effects, unavailable }
}

/** What Stripe's recent Checkout sessions say about moving this group now. */
export function classifyCheckouts(
  sessions: Pick<Stripe.Checkout.Session, 'id' | 'status' | 'payment_status' | 'metadata'>[],
  seatStatus: Map<string, string | null>,
  groupPaymentRecorded: boolean,
  /** People who keep paying by their own link: their open checkout is left alone. */
  keepSeat: (participantId: string) => boolean = () => false,
): { toExpire: string[]; paymentInFlight: boolean } {
  const toExpire: string[] = []
  let paymentInFlight = false
  for (const session of sessions) {
    if (session.status === 'open') {
      const participantId = session.metadata?.participantId
      const isSeat = session.metadata?.isIndividualGroupPayment === 'true'
      if (!(isSeat && participantId && keepSeat(participantId))) toExpire.push(session.id)
    } else if (session.status === 'complete') {
      const participantId = session.metadata?.participantId
      if (session.metadata?.isIndividualGroupPayment === 'true') {
        // A person who has since been removed from the roster isn't owed a wait.
        if (participantId && seatStatus.has(participantId) && seatStatus.get(participantId) !== 'paid') paymentInFlight = true
      } else if (!groupPaymentRecorded) {
        paymentInFlight = true
      }
    }
  }
  return { toExpire, paymentInFlight }
}

// ── "Invoice for some": who goes where ───────────────────────────────────────

export interface SplitPlan {
  /** Each person's payer after the change. */
  payers: Map<string, Payer>
  /** Places on the organizer's invoice after the change. */
  invoiceSeats: number
}

/**
 * Who pays for what once the ticked people go on the invoice. Anyone who has
 * already paid their own place stays paid (and off the invoice), and so does a
 * place with nothing to pay.
 */
export function splitPlan(input: {
  declaredSeats: number
  roster: Pick<RosterRow, 'id' | 'individual_payment_status'>[]
  invoiceIds: Set<string>
  lateJoinerPayer: LateJoinerPayer
}): SplitPlan {
  const payers = new Map<string, Payer>()
  for (const p of input.roster) {
    const settled = p.individual_payment_status === 'paid' || p.individual_payment_status === 'waived'
    payers.set(p.id, !settled && input.invoiceIds.has(p.id) ? 'group' : 'self')
  }
  const after = input.roster.map((p) => ({
    payer: payers.get(p.id),
    // A link moving onto the invoice is stood down, so it no longer reads as owed.
    individual_payment_status: payers.get(p.id) === 'group' ? null : p.individual_payment_status,
  }))
  const invoiceSeats = seatsOnInvoice(input.declaredSeats, after, { member_pays_individually: false, late_joiner_payer: input.lateJoinerPayer })
  return { payers, invoiceSeats }
}

// ── Reads ────────────────────────────────────────────────────────────────────

interface RosterRow {
  id: string
  email: string | null
  first_name: string
  last_name: string
  event_role: string | null
  payer: string | null
  individual_payment_status: string | null
  individual_payment_link_sent_at: string | null
}

async function loadRoster(db: Db, registrationId: string): Promise<RosterRow[]> {
  const { data, error } = await db
    .from('participants')
    .select('id, email, first_name, last_name, event_role, payer, individual_payment_status, individual_payment_link_sent_at')
    .eq('registration_id', registrationId)
  if (error) throw new Error(`Could not read the roster: ${error.message}`)
  return (data ?? []) as RosterRow[]
}

const owesSeat = (p: Pick<RosterRow, 'individual_payment_status'>) => p.individual_payment_status !== 'paid' && p.individual_payment_status !== 'waived'

async function loadFacts(db: Db, stripe: Stripe, reg: GroupRegistration, roster: RosterRow[]): Promise<PaymentChangeFacts> {
  const mode = billingMode(reg)
  const current = reg.invoice_requested ? await currentSeatsInvoice(db, stripe, reg) : null
  const price = await eventSeatPrice(stripe, reg.event_slug)
  const unpaid = roster.filter(owesSeat)
  return {
    type: reg.type,
    status: reg.status,
    mode,
    plan: paymentPlan(reg),
    // Stripe is the source of truth for an invoice: a missed webhook mustn't let a
    // paid invoice be treated as a balance to move.
    invoicePaid: !!reg.invoice_paid_at || current?.invoice.status === 'paid',
    cardPaid: mode === 'card' && (!!reg.stripe_payment_intent_id || reg.status === 'confirmed'),
    declaredSeats: (reg.adult_count ?? 0) + (reg.student_count ?? 0) || roster.length,
    paidSeats: roster.filter((p) => p.individual_payment_status === 'paid').length,
    perSeatCents: price?.unitCents ?? null,
    currency: price?.currency ?? 'usd',
    coupon: await couponTerms(stripe, reg.invoice_coupon_id),
    rosterUnpaid: unpaid.filter((p) => p.email?.trim()).length,
    rosterNoEmail: unpaid.filter((p) => !p.email?.trim()).length,
    openInvoiceNumber: current?.invoice.status === 'open' ? current.invoice.number ?? null : null,
    unpaidAdults: roster.filter((p) => isAdultRole(p.event_role) && owesSeat(p)).length,
    students: Math.max(reg.student_count ?? 0, roster.filter((p) => !isAdultRole(p.event_role)).length),
  }
}

export interface SplitPersonView {
  id: string
  name: string
  bucket: 'adult' | 'student'
  /** On the organizer's invoice now (or, for a group not yet split, ticked by default: the adults). */
  onInvoice: boolean
  /** Why this person can't move, e.g. their place is already paid. */
  locked: string | null
}

/** What the "Invoice for some" choice needs to show and price the ticks. */
export interface SplitView {
  people: SplitPersonView[]
  lateJoinerPayer: LateJoinerPayer
  /** Declared places nobody has filled yet: they follow lateJoinerPayer. */
  unfilledSeats: number
  perSeatCents: number
  currency: string
  coupon: CouponTerms | null
}

/** What the "share the teacher's cost" choice needs to show, and how it stands now. */
export interface ShareView {
  /** A teacher's full price. */
  unitCents: number
  currency: string
  /** Adults whose cost would be shared. */
  unpaidAdults: number
  /** Students declared or on the roster: the starting estimate. */
  students: number
  /** The group already shares the teacher's cost: where it stands. */
  current: ShareSummary | null
}

export interface PaymentChangeView {
  current: GroupPaymentPlan
  currentLabel: string
  blockedReason: string | null
  options: PaymentChangeOption[]
  split: SplitView | null
  share: ShareView | null
}

const currentLabel = (plan: GroupPaymentPlan) => (plan === 'free' ? 'No payment needed' : PAYMENT_METHOD_LABEL[plan])

function splitView(reg: GroupRegistration, roster: RosterRow[], facts: PaymentChangeFacts): SplitView {
  const split = isSplitGroup(reg)
  const people = roster
    .map((p): SplitPersonView => {
      const bucket = seatBucket(p.event_role)
      const locked = p.individual_payment_status === 'paid' ? 'Paid'
        : p.individual_payment_status === 'waived' ? 'Nothing to pay'
          : null
      const onInvoice = locked ? false : split ? payerOf(p, reg) === 'group' : bucket === 'adult'
      return { id: p.id, name: `${p.first_name} ${p.last_name}`.trim(), bucket, onInvoice, locked }
    })
    .sort((a, b) => (a.bucket === b.bucket ? a.name.localeCompare(b.name) : a.bucket === 'adult' ? -1 : 1))
  return {
    people,
    lateJoinerPayer: isLateJoinerPayer(reg.late_joiner_payer) ? reg.late_joiner_payer : 'self',
    unfilledSeats: Math.max(0, facts.declaredSeats - roster.length),
    perSeatCents: facts.perSeatCents ?? 0,
    currency: facts.currency,
    coupon: facts.coupon,
  }
}

async function shareView(db: Db, reg: GroupRegistration, facts: PaymentChangeFacts): Promise<ShareView> {
  let current: ShareSummary | null = null
  if (isSharedGroup(reg)) {
    const loaded = await loadShareGroup(db, reg.id)
    if (loaded) current = summarise(loaded.reg, loaded.people)
  }
  return {
    unitCents: facts.perSeatCents ?? 0,
    currency: facts.currency,
    unpaidAdults: facts.unpaidAdults ?? 0,
    students: facts.students ?? 0,
    current,
  }
}

/** The dialog's data: how the group pays now, and what each alternative would do. */
export async function paymentChangeView(db: Db, stripe: Stripe | null, registrationId: string): Promise<PaymentChangeView | null> {
  const reg = await loadRegistration(db, registrationId)
  if (!reg || reg.type !== 'group') return null
  const plan = paymentPlan(reg)
  if (!stripe) return { current: plan, currentLabel: currentLabel(plan), blockedReason: 'Payments are not configured here.', options: [], split: null, share: null }
  const roster = await loadRoster(db, registrationId)
  const facts = await loadFacts(db, stripe, reg, roster)
  const blockedReason = changeBlockReason(facts)
  return {
    current: plan,
    currentLabel: currentLabel(plan),
    blockedReason,
    // A split group can change who is on its invoice, and a sharing group its
    // estimate, so each is offered again.
    options: blockedReason ? [] : PAYMENT_METHODS.filter((m) => m !== plan || m === 'invoice_some' || m === 'teacher_share').map((m) => describeChange(facts, m)),
    split: blockedReason ? null : splitView(reg, roster, facts),
    share: await shareView(db, reg, facts),
  }
}

// ── The change ───────────────────────────────────────────────────────────────

export interface PaymentChangeActor {
  memberId: string | null
  label: string
  /** Staff act for the group; an organizer's own change is worth telling staff about. */
  by: 'staff' | 'organizer'
}

export type PaymentChangeResult =
  | { ok: true; method: GroupPaymentMethod; message: string; payUrl: string | null }
  /** `code` is set only on the tenant payments answer (S5 A8). */
  | { ok: false; status: number; error: string; code?: string }

const refuse = (status: number, error: string): PaymentChangeResult => ({ ok: false, status, error })
const stripeDetail = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\.+$/, '')

/** Every recent Checkout for this registration, whichever route minted it. Seat sessions aren't recorded anywhere else. */
async function recentCheckouts(stripe: Stripe, registrationId: string): Promise<Stripe.Checkout.Session[]> {
  const sessions = await stripe.checkout.sessions
    .list({ created: { gte: Math.floor((Date.now() - CHECKOUT_LOOKBACK_MS) / 1000) }, limit: 100 })
    .autoPagingToArray({ limit: 5000 })
  return sessions.filter((s) => s.metadata?.registrationId === registrationId || s.client_reference_id === registrationId)
}

/** False when a session couldn't be expired because it has just been paid. */
async function expireCheckouts(stripe: Stripe, ids: string[]): Promise<boolean> {
  for (const id of ids) {
    try {
      await stripe.checkout.sessions.expire(id)
    } catch (e) {
      const session = await stripe.checkout.sessions.retrieve(id).catch(() => null)
      if (session?.status === 'expired') continue
      console.error('[group-payment-change] could not expire checkout:', id, e)
      return false
    }
  }
  return true
}

/** Every open invoice for the group: the main one and any "additional places" ones. Returns the numbers voided. */
async function voidOpenInvoices(db: Db, stripe: Stripe, reg: GroupRegistration, why: string): Promise<string[]> {
  const open = new Map<string, Stripe.Invoice>()
  const current = await currentSeatsInvoice(db, stripe, reg)
  if (current?.invoice.status === 'open') open.set(current.invoice.id as string, current.invoice)
  for (const row of await ledgerFor(db, reg.id)) {
    if (row.status === 'open' && !open.has(row.stripe_invoice_id)) {
      const invoice = await stripe.invoices.retrieve(row.stripe_invoice_id)
      if (invoice.status === 'open') open.set(invoice.id as string, invoice)
    }
  }
  const numbers: string[] = []
  for (const invoice of open.values()) {
    await voidGroupInvoice(db, stripe, invoice, why)
    numbers.push(invoice.number ?? (invoice.id as string))
  }
  return numbers
}

/**
 * Moves a group to `to`. Never throws: a refusal explains itself, and a failure
 * after the group has moved alerts staff and says so.
 */
export async function changeGroupPaymentMethod(
  db: Db,
  stripe: Stripe,
  registrationId: string,
  to: GroupPaymentMethod | PaymentChangeRequest,
  actor: PaymentChangeActor,
): Promise<PaymentChangeResult> {
  const request: PaymentChangeRequest = typeof to === 'string' ? { method: to } : to
  try {
    const result = await withInvoiceLock(db, registrationId, () => applyChange(db, stripe, registrationId, request, actor))
    return result ?? refuse(409, 'This group’s billing is being updated right now. Try again in a moment.')
  } catch (e) {
    console.error('[group-payment-change] failed:', e, { registrationId, to: request.method })
    return refuse(502, `The payment method wasn’t changed: ${stripeDetail(e)}.`)
  }
}

const names = (people: Pick<RosterRow, 'first_name' | 'last_name'>[]) =>
  people.map((p) => `${p.first_name} ${p.last_name}`.trim()).join(', ')

async function applyChange(
  db: Db,
  stripe: Stripe,
  registrationId: string,
  request: PaymentChangeRequest,
  actor: PaymentChangeActor,
): Promise<PaymentChangeResult> {
  const to = request.method
  const reg = await loadRegistration(db, registrationId)
  if (!reg || reg.type !== 'group') return refuse(404, 'Group registration not found')
  // S5 A8: nothing is billed for another tenant until S9. Refused here, before the
  // facts below ask Stripe anything; whoever called (organiser or staff) checked access.
  if (rowTenant(reg.tenant_id) !== STELLR_TENANT_ID) return { ok: false, status: 503, error: TENANT_PAYMENTS_UNAVAILABLE.error, code: TENANT_PAYMENTS_UNAVAILABLE.code }
  const roster = await loadRoster(db, registrationId)
  const facts = await loadFacts(db, stripe, reg, roster)
  const blocked = changeBlockReason(facts)
  if (blocked) return refuse(409, blocked)
  const from = facts.plan as GroupPaymentMethod
  if (from === to && to !== 'invoice_some' && to !== 'teacher_share') return refuse(409, 'This group already pays that way.')

  // ── Sharing the teacher's cost: settled, or only the estimate moving ───────
  const sharing = from === 'teacher_share' ? await loadShareGroup(db, registrationId) : null
  if (sharing?.reg.share_settled_at) {
    return refuse(409, 'The teacher’s cost for this group was settled after the event, so how it pays can’t change now. Contact Stellr if something needs correcting.')
  }
  if (to === 'teacher_share' && from === 'teacher_share' && sharing) {
    return changeShareEstimate(db, registrationId, sharing.reg, request.shareEstimate)
  }

  const option = describeChange(facts, to)
  if (option.unavailable) return refuse(409, option.unavailable)

  // ── Who pays for what afterwards ───────────────────────────────────────────
  let split: SplitPlan | null = null
  let lateJoinerPayer: LateJoinerPayer | null = null
  if (to === 'invoice_some') {
    lateJoinerPayer = request.lateJoinerPayer ?? 'self'
    const ids = new Set(request.invoiceParticipantIds ?? [])
    const onRoster = new Set(roster.map((p) => p.id))
    if ([...ids].some((id) => !onRoster.has(id))) return refuse(400, 'Someone on that list isn’t in this group any more. Reload and try again.')
    const settled = roster.filter((p) => ids.has(p.id) && !owesSeat(p))
    if (settled.length > 0) return refuse(409, `${names(settled)} ${settled.length === 1 ? 'has' : 'have'} already paid, so ${settled.length === 1 ? 'that place' : 'those places'} can’t go on the invoice.`)
    split = splitPlan({ declaredSeats: facts.declaredSeats, roster, invoiceIds: ids, lateJoinerPayer })
    if (split.invoiceSeats <= 0) return refuse(409, 'Nobody would be on the invoice. To have everyone pay their own way, choose “Group members pay individually”.')
    if (from === 'invoice_some' && reg.late_joiner_payer === lateJoinerPayer
      && roster.every((p) => payerOf(p, reg) === split!.payers.get(p.id) || !owesSeat(p))) {
      return refuse(409, 'Nothing would change: those are the people on the invoice now.')
    }
  }
  // Sharing the teacher's cost: unpaid adults are covered by the students' shares.
  const shareEstimate = to === 'teacher_share' ? request.shareEstimate ?? facts.students ?? 1 : null
  const sharedAdult = (p: RosterRow) => to === 'teacher_share' && isAdultRole(p.event_role) && owesSeat(p)
  const paysOwnWay = (p: RosterRow) => to === 'individual' || (split?.payers.get(p.id) === 'self') || (to === 'teacher_share' && !sharedAdult(p))

  const perSeat = facts.perSeatCents as number
  const owed = split ? split.invoiceSeats : billableSeats(facts.declaredSeats, facts.paidSeats)
  const { totalCents } = invoiceTotals(owed, perSeat, facts.coupon)
  if (split && totalCents <= 0) return refuse(409, 'The total for those places is $0.00, so no invoice can be sent.')
  // An open invoice that stays an invoice is revised, not cancelled and reissued.
  const revise = facts.mode === 'invoice' && !!facts.openInvoiceNumber && (to === 'invoice' || to === 'invoice_some')
  const label = PAYMENT_METHOD_LABEL[to]

  // ── Close what's payable under the old method ──────────────────────────────
  const seatStatus = new Map(roster.map((p) => [p.id, p.individual_payment_status]))
  const byId = new Map(roster.map((p) => [p.id, p]))
  const { toExpire, paymentInFlight } = classifyCheckouts(
    await recentCheckouts(stripe, registrationId),
    seatStatus,
    !!reg.stripe_payment_intent_id,
    // Someone who keeps paying by link may be mid-payment: leave them be.
    (id) => byId.has(id) && paysOwnWay(byId.get(id) as RosterRow) && byId.get(id)?.individual_payment_status === 'pending',
  )
  const settling = 'A payment for this group is going through. Wait a minute for it to record, then try again.'
  if (paymentInFlight) return refuse(409, settling)
  if (!(await expireCheckouts(stripe, toExpire))) return refuse(409, settling)

  let voided: string[] = []
  if (!revise) {
    try {
      voided = await voidOpenInvoices(db, stripe, reg, `Cancelled: the group changed to "${label}"`)
    } catch (e) {
      // Stripe refuses to void an invoice that was just paid or has a payment
      // processing. Nothing has moved, so the group still pays the way it did.
      console.error('[group-payment-change] void failed:', e, { registrationId })
      return refuse(409, `The current invoice couldn’t be cancelled, so nothing was changed. A payment may be processing: ${stripeDetail(e)}.`)
    }
  }

  // ── Move the group ─────────────────────────────────────────────────────────
  let move = db.from('registrations')
    .update({
      invoice_requested: to === 'invoice' || to === 'invoice_some',
      member_pays_individually: to === 'individual' || to === 'teacher_share',
      late_joiner_payer: lateJoinerPayer,
      // Sharing the teacher's cost starts afresh; leaving it clears these (unwindShares).
      ...(to === 'teacher_share'
        ? { share_estimate: shareEstimate, share_unit_cents: perSeat, share_cents: null, share_first_paid_at: null, share_settled_at: null }
        : {}),
      // Pending whatever it was: with no invoice to consult, 'confirmed' reads as paid
      // (lib/payment-status), and an unpaid group must not.
      status: 'pending',
      amount_due_cents: to === 'individual' || to === 'teacher_share' ? facts.declaredSeats * perSeat : totalCents,
      checkout_session_id: null,
      pay_link_sent_at: null,
      // A revised invoice is queued below; anything else starts afresh.
      ...(revise ? {} : { invoice_sync_due_at: null }),
    })
    .eq('id', reg.id)
    .eq('invoice_requested', !!reg.invoice_requested)
    .eq('member_pays_individually', !!reg.member_pays_individually)
  move = reg.late_joiner_payer == null ? move.is('late_joiner_payer', null) : move.eq('late_joiner_payer', reg.late_joiner_payer)
  const { data: moved, error: moveError } = await move.select('id')
  if (moveError || (moved ?? []).length === 0) {
    const detail = moveError?.message ?? 'another change got there first'
    await alertStaff(`The ${reg.event_title} group registered by ${reg.teacher_email ?? 'an organizer'} was moving to "${label}", but saving it failed (${detail}). ${voided.length ? `Invoice ${voided.join(', ')} was already cancelled. ` : ''}Check the group on the event roster.`)
    return refuse(502, `The payment method wasn’t saved: ${detail}. Our team has been alerted.`)
  }

  // ── Leaving the shared cost: every share paid goes back ────────────────────
  let shareRefunds: { refunded: number; failed: number } | null = null
  if (from === 'teacher_share') shareRefunds = await unwindShares(db, stripe, reg.id)

  // ── Who pays for each person ───────────────────────────────────────────────
  // A split group names everyone's payer; any other way to pay goes back to the
  // group's flags deciding (a NULL payer).
  const payerWrites: Array<{ payer: Payer | null; ids: string[] }> = split
    ? (['group', 'self'] as const).map((payer) => ({ payer, ids: roster.filter((p) => split!.payers.get(p.id) === payer).map((p) => p.id) }))
    : to === 'teacher_share'
      ? [
          { payer: 'shared', ids: roster.filter(sharedAdult).map((p) => p.id) },
          { payer: 'self', ids: roster.filter((p) => !sharedAdult(p)).map((p) => p.id) },
        ]
      : [{ payer: null, ids: roster.filter((p) => p.payer != null).map((p) => p.id) }]
  for (const { payer, ids } of payerWrites) {
    if (ids.length === 0) continue
    const { error } = await db.from('participants').update({ payer }).in('id', ids)
    if (error) console.error('[group-payment-change] payer write failed:', error.message, { registrationId, payer })
  }

  // ── Stand down links that are no longer owed, and tell whoever had one ─────
  const stoodDown = roster.filter((p) => p.individual_payment_status === 'pending' && !paysOwnWay(p))
  if (stoodDown.length > 0) {
    const { error } = await db.from('participants')
      .update({ individual_payment_status: null, individual_payment_link_sent_at: null })
      .in('id', stoodDown.map((p) => p.id))
    if (error) console.error('[group-payment-change] seat reset failed:', error.message, { registrationId })
  }
  // Covered teachers owe nothing directly.
  const covered = roster.filter(sharedAdult).map((p) => p.id)
  if (covered.length > 0) {
    const { error } = await db.from('participants').update({ individual_payment_status: 'covered' }).in('id', covered)
    if (error) console.error('[group-payment-change] covering teachers failed:', error.message, { registrationId })
  }
  await Promise.allSettled(
    stoodDown.filter((p) => p.individual_payment_link_sent_at && p.email?.trim()).map((p) => sendEmail({
      to: p.email as string,
      ...groupSeatPaymentNoLongerDueEmail({ firstName: p.first_name, eventTitle: reg.event_title, registrationId: reg.id }),
    })),
  )

  // ── Start the new method ───────────────────────────────────────────────────
  const fresh = (await loadRegistration(db, reg.id)) ?? reg
  let failure: string | null = null
  let payUrl: string | null = null
  const details: string[] = []
  try {
    if (to === 'invoice' || to === 'invoice_some') {
      if (revise) {
        if (!(await queueInvoiceSync(db, stripe, fresh.id))) throw new Error('the invoice update could not be scheduled')
        details.push(`An updated invoice for ${plural(owed, 'place')} (${formatMoney(totalCents, facts.currency)}) goes to ${fresh.teacher_email ?? 'the organizer'} in a couple of minutes.`)
      } else {
        const sent = await createGroupInvoice(db, stripe, {
          reg: fresh,
          customerId: await invoiceCustomer(db, stripe, fresh, null),
          seats: owed,
          perSeatCents: perSeat,
          currency: facts.currency,
          reason: to === 'invoice_some'
            ? `Invoice for ${plural(owed, 'place')}; the rest of the group pays individually`
            : `Group changed to pay by invoice${facts.paidSeats > 0 ? ` (${plural(facts.paidSeats, 'place')} already paid individually)` : ''}`,
          actor: { memberId: actor.memberId, label: actor.label },
          couponId: fresh.invoice_coupon_id,
          kind: 'seats',
        })
        details.push(`A new invoice for ${plural(owed, 'place')} (${formatMoney(sent.total ?? 0, facts.currency)}) has been emailed to ${fresh.teacher_email ?? 'the organizer'}.`)
      }
    } else if (to === 'card') {
      payUrl = payPageUrl(fresh.event_slug, await ensurePayToken(db, fresh.id))
      const sent = await sendPayLinkEmail(db, fresh.id, { force: true })
      details.push(sent.sent
        ? `A link to pay ${formatMoney(totalCents, facts.currency)} by card has been emailed to ${fresh.teacher_email ?? 'the organizer'}.`
        : `The organizer can pay ${formatMoney(totalCents, facts.currency)} from the link here.`)
    }
  } catch (e) {
    failure = stripeDetail(e)
  }

  if (to === 'individual' || to === 'invoice_some' || to === 'teacher_share') {
    try {
      const ownWay = roster.filter(owesSeat).filter(paysOwnWay)
      const people: IndividualPaymentPerson[] = ownWay.filter((p) => p.email?.trim()).map((p) => ({
        participantId: p.id, email: p.email as string, firstName: p.first_name, lastName: p.last_name,
      }))
      const outcome = await ensureIndividualPayments(db, fresh.id, people)
      const missed = people.length - outcome.charged - outcome.waived - outcome.skipped
      if (missed > 0) failure = [failure, `${plural(missed, 'payment link')} could not be sent`].filter(Boolean).join('; ')
      const later = to === 'individual' || lateJoinerPayer === 'self'
        ? 'Anyone added later gets one when they join.'
        : 'Anyone added later goes on the invoice.'
      if (to === 'teacher_share') {
        const summary = await refreshShare(db, fresh.id)
        details.push(`Teachers pay nothing directly. Each student’s link now includes ${formatMoney(summary?.shareCents ?? 0, facts.currency)} toward the teacher’s cost, and that can only go down.${outcome.charged > 0 ? ` ${plural(outcome.charged, 'student')} ${outcome.charged === 1 ? 'has' : 'have'} been emailed a payment link.` : ''}`)
      } else if (to === 'individual') {
        details.push(people.length > 0
          ? `Payment links have gone to ${outcome.charged} of ${plural(people.length, 'person').replace('persons', 'people')} on the roster. ${later}`
          : 'Each person gets a payment link when they join the group.')
      } else {
        details.push(outcome.charged > 0
          ? `${plural(outcome.charged, 'person').replace('persons', 'people')} ${outcome.charged === 1 ? 'has' : 'have'} been emailed a link to pay for their own place. ${later}`
          : `Everyone else keeps the payment link they already have. ${later}`)
      }
    } catch (e) {
      failure = [failure, stripeDetail(e)].filter(Boolean).join('; ')
    }
  }
  if (shareRefunds && shareRefunds.refunded > 0) {
    details.push(`${plural(shareRefunds.refunded, 'share')} of the teacher’s cost ${shareRefunds.refunded === 1 ? 'has' : 'have'} been refunded.`)
  }
  if (shareRefunds && shareRefunds.failed > 0) {
    failure = [failure, `${plural(shareRefunds.failed, 'share refund')} couldn’t be made`].filter(Boolean).join('; ')
  }
  const detail = details.join(' ')

  if (failure) {
    console.error('[group-payment-change] new method did not fully start:', failure, { registrationId, to })
    await alertStaff(`The ${reg.event_title} group registered by ${reg.teacher_email ?? 'an organizer'} moved to "${label}", but ${failure}. Open the event roster and finish it from the group's header.`)
  } else if (actor.by === 'organizer') {
    await alertStaff(`${reg.teacher_email ?? 'The organizer'} changed how their ${reg.event_title} group pays: "${PAYMENT_METHOD_LABEL[from]}" → "${label}".${voided.length ? ` Invoice ${voided.join(', ')} was cancelled.` : ''}`)
  }

  // The organizer always hears, whoever made the change.
  if (fresh.teacher_email) {
    const { data: poc } = await db.from('registrations').select('teacher_poc_email').eq('id', fresh.id).maybeSingle()
    const cc = (poc as { teacher_poc_email?: string | null } | null)?.teacher_poc_email
    await sendEmail({
      to: fresh.teacher_email,
      cc: cc ? [cc] : [],
      ...groupPaymentMethodChangedEmail({
        firstName: fresh.teacher_first_name ?? 'there',
        eventTitle: fresh.event_title,
        registrationId: fresh.id,
        methodLabel: label,
        cancelledInvoices: voided,
        nextStep: failure ? 'Our team is finishing this change and will be in touch.' : detail,
        paidPlaces: facts.paidSeats,
        payUrl,
      }),
    }).catch((e) => console.error('[group-payment-change] organizer email failed:', e, { registrationId }))
  }

  return {
    ok: true,
    method: to,
    payUrl,
    message: failure
      ? `The group now pays by "${label}", but ${failure}. Our team has been alerted.`
      : `The group now pays by "${label}". ${detail}`,
  }
}

/**
 * A sharing group's estimate changes. Raising it lowers the share and is always
 * allowed; lowering it would raise the share, so only before anyone has paid.
 */
async function changeShareEstimate(
  db: Db,
  registrationId: string,
  reg: { share_estimate: number | null; share_first_paid_at: string | null },
  estimate: number | undefined,
): Promise<PaymentChangeResult> {
  if (!estimate || estimate < 1) return refuse(400, 'Say how many students you expect to bring.')
  if (estimate === reg.share_estimate) return refuse(409, 'Nothing would change: that is the estimate now.')
  if (reg.share_first_paid_at && estimate < (reg.share_estimate ?? 0)) {
    return refuse(409, `A student has already paid a share, so the estimate can only go up (it is ${reg.share_estimate} now). The share never rises.`)
  }
  let write = db.from('registrations').update({ share_estimate: estimate }).eq('id', registrationId)
  write = reg.share_estimate == null ? write.is('share_estimate', null) : write.eq('share_estimate', reg.share_estimate)
  const { data, error } = await write.select('id')
  if (error || (data ?? []).length === 0) return refuse(409, 'The estimate changed while you were editing. Reload and try again.')
  const summary = await refreshShare(db, registrationId)
  const money = formatMoney(summary?.shareCents ?? 0, 'usd')
  return {
    ok: true,
    method: 'teacher_share',
    payUrl: null,
    message: `The estimate is now ${plural(estimate, 'student')}. Each student’s share of the teacher’s cost is ${money}.`,
  }
}

// ── Webhook: a payment that arrives after the group moved ────────────────────

/**
 * Expiring sessions closes almost every route to this; a Stripe race can still
 * land a payment through the old method. A seat paid on an invoiced group shrinks
 * the invoice at its next sync. Anything else needs a person. Never throws: the
 * payment itself has already been recorded.
 */
export async function notePaymentAfterMethodChange(
  db: Db,
  registrationId: string,
  paidThrough: 'seat' | 'group',
): Promise<void> {
  try {
    const reg = await loadRegistration(db, registrationId)
    if (!reg) return
    if (paidThrough === 'seat') {
      if (reg.member_pays_individually) return
      // A split group expects seat payments. If the place was on the invoice (paid
      // through a link stood down a moment ago), the next sync takes it off.
      if (isSplitGroup(reg)) {
        await markInvoiceSyncDue(db, registrationId)
        return
      }
      if (reg.invoice_requested) await markInvoiceSyncDue(db, registrationId)
      await alertStaff(`A place on the ${reg.event_title} group (${reg.teacher_email ?? 'organizer unknown'}) was paid through an old individual link after the group changed how it pays. The place is recorded as paid. Check the group's balance on the event roster.`)
    } else if (reg.invoice_requested || reg.member_pays_individually) {
      await alertStaff(`The ${reg.event_title} group (${reg.teacher_email ?? 'organizer unknown'}) paid by card after changing how it pays, so it may have been asked to pay twice. Check the group on the event roster and cancel or refund as needed.`)
    }
  } catch (e) {
    console.error('[group-payment-change] late payment check failed:', e, { registrationId })
  }
}
