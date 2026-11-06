import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
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
  paidSeatCount,
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

type Db = SupabaseClient

export type GroupPaymentMethod = Exclude<GroupBillingMode, 'free'>

export const PAYMENT_METHODS: GroupPaymentMethod[] = ['invoice', 'card', 'individual']

export const PAYMENT_METHOD_LABEL: Record<GroupPaymentMethod, string> = {
  invoice: 'Invoice emailed to the organizer',
  card: 'Credit card, paid by the organizer',
  individual: 'Group members pay individually',
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

  if (f.mode === 'invoice') {
    effects.push(f.openInvoiceNumber ? `Invoice ${f.openInvoiceNumber} is cancelled.` : 'Any unpaid invoice is cancelled.')
  } else if (f.mode === 'individual') {
    effects.push('Payment links already sent stop working, and anyone who received one is told nothing is due.')
  } else if (f.mode === 'card') {
    effects.push('Any card payment page already open stops working.')
  }

  let unavailable: string | null = null
  if (to === 'invoice') {
    effects.push(`The organizer is emailed a new invoice for ${plural(owed, 'place')}: ${money(totalCents)}, due in 14 days.`)
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
): { toExpire: string[]; paymentInFlight: boolean } {
  const toExpire: string[] = []
  let paymentInFlight = false
  for (const session of sessions) {
    if (session.status === 'open') {
      toExpire.push(session.id)
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

// ── Reads ────────────────────────────────────────────────────────────────────

interface RosterRow {
  id: string
  email: string | null
  first_name: string
  last_name: string
  individual_payment_status: string | null
  individual_payment_link_sent_at: string | null
}

async function loadRoster(db: Db, registrationId: string): Promise<RosterRow[]> {
  const { data, error } = await db
    .from('participants')
    .select('id, email, first_name, last_name, individual_payment_status, individual_payment_link_sent_at')
    .eq('registration_id', registrationId)
  if (error) throw new Error(`Could not read the roster: ${error.message}`)
  return (data ?? []) as RosterRow[]
}

const owesSeat = (p: RosterRow) => p.individual_payment_status !== 'paid' && p.individual_payment_status !== 'waived'

async function loadFacts(db: Db, stripe: Stripe, reg: GroupRegistration, roster: RosterRow[]): Promise<PaymentChangeFacts> {
  const mode = billingMode(reg)
  const current = reg.invoice_requested ? await currentSeatsInvoice(db, stripe, reg) : null
  const price = await eventSeatPrice(stripe, reg.event_slug)
  const unpaid = roster.filter(owesSeat)
  return {
    type: reg.type,
    status: reg.status,
    mode,
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
  }
}

export interface PaymentChangeView {
  current: GroupBillingMode
  currentLabel: string
  blockedReason: string | null
  options: PaymentChangeOption[]
}

const currentLabel = (mode: GroupBillingMode) => (mode === 'free' ? 'No payment needed' : PAYMENT_METHOD_LABEL[mode])

/** The dialog's data: how the group pays now, and what each alternative would do. */
export async function paymentChangeView(db: Db, stripe: Stripe | null, registrationId: string): Promise<PaymentChangeView | null> {
  const reg = await loadRegistration(db, registrationId)
  if (!reg || reg.type !== 'group') return null
  const mode = billingMode(reg)
  if (!stripe) return { current: mode, currentLabel: currentLabel(mode), blockedReason: 'Payments are not configured here.', options: [] }
  const facts = await loadFacts(db, stripe, reg, await loadRoster(db, registrationId))
  const blockedReason = changeBlockReason(facts)
  return {
    current: mode,
    currentLabel: currentLabel(mode),
    blockedReason,
    options: blockedReason ? [] : PAYMENT_METHODS.filter((m) => m !== mode).map((m) => describeChange(facts, m)),
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
  | { ok: false; status: number; error: string }

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
  to: GroupPaymentMethod,
  actor: PaymentChangeActor,
): Promise<PaymentChangeResult> {
  try {
    const result = await withInvoiceLock(db, registrationId, () => applyChange(db, stripe, registrationId, to, actor))
    return result ?? refuse(409, 'This group’s billing is being updated right now. Try again in a moment.')
  } catch (e) {
    console.error('[group-payment-change] failed:', e, { registrationId, to })
    return refuse(502, `The payment method wasn’t changed: ${stripeDetail(e)}.`)
  }
}

async function applyChange(
  db: Db,
  stripe: Stripe,
  registrationId: string,
  to: GroupPaymentMethod,
  actor: PaymentChangeActor,
): Promise<PaymentChangeResult> {
  const reg = await loadRegistration(db, registrationId)
  if (!reg || reg.type !== 'group') return refuse(404, 'Group registration not found')
  const roster = await loadRoster(db, registrationId)
  const facts = await loadFacts(db, stripe, reg, roster)
  const blocked = changeBlockReason(facts)
  if (blocked) return refuse(409, blocked)
  if (facts.mode === to) return refuse(409, 'This group already pays that way.')
  const option = describeChange(facts, to)
  if (option.unavailable) return refuse(409, option.unavailable)
  const from = facts.mode as GroupPaymentMethod

  // ── Close what's payable under the old method ──────────────────────────────
  const seatStatus = new Map(roster.map((p) => [p.id, p.individual_payment_status]))
  const { toExpire, paymentInFlight } = classifyCheckouts(
    await recentCheckouts(stripe, registrationId),
    seatStatus,
    !!reg.stripe_payment_intent_id,
  )
  const settling = 'A payment for this group is going through. Wait a minute for it to record, then try again.'
  if (paymentInFlight) return refuse(409, settling)
  if (!(await expireCheckouts(stripe, toExpire))) return refuse(409, settling)

  let voided: string[]
  try {
    voided = await voidOpenInvoices(db, stripe, reg, `Cancelled: the group changed to "${PAYMENT_METHOD_LABEL[to]}"`)
  } catch (e) {
    // Stripe refuses to void an invoice that was just paid or has a payment
    // processing. Nothing has moved, so the group still pays the way it did.
    console.error('[group-payment-change] void failed:', e, { registrationId })
    return refuse(409, `The current invoice couldn’t be cancelled, so nothing was changed. A payment may be processing: ${stripeDetail(e)}.`)
  }

  // ── Move the group ─────────────────────────────────────────────────────────
  const owed = billableSeats(facts.declaredSeats, facts.paidSeats)
  const perSeat = facts.perSeatCents as number
  const { totalCents } = invoiceTotals(owed, perSeat, facts.coupon)
  const { data: moved, error: moveError } = await db.from('registrations')
    .update({
      invoice_requested: to === 'invoice',
      member_pays_individually: to === 'individual',
      // Pending whatever it was: with no invoice to consult, 'confirmed' reads as paid
      // (lib/payment-status), and an unpaid group must not.
      status: 'pending',
      amount_due_cents: to === 'individual' ? facts.declaredSeats * perSeat : totalCents,
      checkout_session_id: null,
      pay_link_sent_at: null,
      invoice_sync_due_at: null,
    })
    .eq('id', reg.id)
    .eq('invoice_requested', !!reg.invoice_requested)
    .eq('member_pays_individually', !!reg.member_pays_individually)
    .select('id')
  if (moveError || (moved ?? []).length === 0) {
    const detail = moveError?.message ?? 'another change got there first'
    await alertStaff(`The ${reg.event_title} group registered by ${reg.teacher_email ?? 'an organizer'} was moving to "${PAYMENT_METHOD_LABEL[to]}", but saving it failed (${detail}). ${voided.length ? `Invoice ${voided.join(', ')} was already cancelled. ` : ''}Check the group on the event roster.`)
    return refuse(502, `The payment method wasn’t saved: ${detail}. Our team has been alerted.`)
  }

  // ── Tidy up per-person state, and tell whoever the old links went to ───────
  if (from === 'individual') {
    const pending = roster.filter((p) => p.individual_payment_status === 'pending')
    if (pending.length > 0) {
      const { error } = await db.from('participants')
        .update({ individual_payment_status: null, individual_payment_link_sent_at: null })
        .in('id', pending.map((p) => p.id))
      if (error) console.error('[group-payment-change] seat reset failed:', error.message, { registrationId })
    }
    await Promise.allSettled(
      pending.filter((p) => p.individual_payment_link_sent_at && p.email?.trim()).map((p) => sendEmail({
        to: p.email as string,
        ...groupSeatPaymentNoLongerDueEmail({ firstName: p.first_name, eventTitle: reg.event_title, registrationId: reg.id }),
      })),
    )
  }

  // ── Start the new method ───────────────────────────────────────────────────
  const fresh = (await loadRegistration(db, reg.id)) ?? reg
  let failure: string | null = null
  let payUrl: string | null = null
  let detail = ''
  try {
    if (to === 'invoice') {
      const sent = await createGroupInvoice(db, stripe, {
        reg: fresh,
        customerId: await invoiceCustomer(db, stripe, fresh, null),
        seats: owed,
        perSeatCents: perSeat,
        currency: facts.currency,
        reason: `Group changed to pay by invoice${facts.paidSeats > 0 ? ` (${plural(facts.paidSeats, 'place')} already paid individually)` : ''}`,
        actor: { memberId: actor.memberId, label: actor.label },
        couponId: fresh.invoice_coupon_id,
        kind: 'seats',
      })
      detail = `A new invoice for ${plural(owed, 'place')} (${formatMoney(sent.total ?? 0, facts.currency)}) has been emailed to ${fresh.teacher_email ?? 'the organizer'}.`
    } else if (to === 'card') {
      payUrl = payPageUrl(fresh.event_slug, await ensurePayToken(db, fresh.id))
      const sent = await sendPayLinkEmail(db, fresh.id, { force: true })
      detail = sent.sent
        ? `A link to pay ${formatMoney(totalCents, facts.currency)} by card has been emailed to ${fresh.teacher_email ?? 'the organizer'}.`
        : `The organizer can pay ${formatMoney(totalCents, facts.currency)} from the link here.`
    } else {
      const people: IndividualPaymentPerson[] = roster.filter(owesSeat).filter((p) => p.email?.trim()).map((p) => ({
        participantId: p.id, email: p.email as string, firstName: p.first_name, lastName: p.last_name,
      }))
      const outcome = await ensureIndividualPayments(db, fresh.id, people)
      const missed = people.length - outcome.charged - outcome.waived - outcome.skipped
      if (missed > 0) failure = `${plural(missed, 'payment link')} could not be sent`
      detail = people.length > 0
        ? `Payment links have gone to ${outcome.charged} of ${plural(people.length, 'person').replace('persons', 'people')} on the roster. Anyone added later gets one when they join.`
        : 'Each person gets a payment link when they join the group.'
    }
  } catch (e) {
    failure = stripeDetail(e)
  }

  if (failure) {
    console.error('[group-payment-change] new method did not fully start:', failure, { registrationId, to })
    await alertStaff(`The ${reg.event_title} group registered by ${reg.teacher_email ?? 'an organizer'} moved to "${PAYMENT_METHOD_LABEL[to]}", but ${failure}. Open the event roster and finish it from the group's header.`)
  } else if (actor.by === 'organizer') {
    await alertStaff(`${reg.teacher_email ?? 'The organizer'} changed how their ${reg.event_title} group pays: "${PAYMENT_METHOD_LABEL[from]}" → "${PAYMENT_METHOD_LABEL[to]}".${voided.length ? ` Invoice ${voided.join(', ')} was cancelled.` : ''}`)
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
        methodLabel: PAYMENT_METHOD_LABEL[to],
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
      ? `The group now pays by "${PAYMENT_METHOD_LABEL[to]}", but ${failure}. Our team has been alerted.`
      : `The group now pays by "${PAYMENT_METHOD_LABEL[to]}". ${detail}`,
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
      if (reg.invoice_requested) await markInvoiceSyncDue(db, registrationId)
      await alertStaff(`A place on the ${reg.event_title} group (${reg.teacher_email ?? 'organizer unknown'}) was paid through an old individual link after the group changed how it pays. The place is recorded as paid. Check the group's balance on the event roster.`)
    } else if (reg.invoice_requested || reg.member_pays_individually) {
      await alertStaff(`The ${reg.event_title} group (${reg.teacher_email ?? 'organizer unknown'}) paid by card after changing how it pays, so it may have been asked to pay twice. Check the group on the event roster and cancel or refund as needed.`)
    }
  } catch (e) {
    console.error('[group-payment-change] late payment check failed:', e, { registrationId })
  }
}
