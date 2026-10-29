import { supabaseServer } from '@/lib/supabase'
import { notifyMember, notifyCommunityAdmins } from '@/lib/notify'
import { logActivity } from '@/lib/activity-log'
import { stripeClient } from '@/lib/stripe'
import { GUARANTEE_DAYS, daysSincePayment, guaranteeRefundOptions } from './policy'
import { assertLiveCredentials } from '@/lib/env-guards'
import { stripeRefundState, isFullyRefunded, remainingCents } from './stripe-state'
import { resolveRefundBasis } from './payment-basis'

/**
 * 'cash' — the money-back guarantee's full refund, if the payment is within
 * 45 days. 'none' — "No refund — remove only". The admin has decided no money
 * goes back (for example, it was already refunded by hand in Stripe). Requires
 * a note.
 */
export type RefundChoice = 'cash' | 'none'

export interface RefundResult {
  type: 'cash' | 'manual_required' | 'none'
  refundCents: number
  stripeRefundId?: string
  detail: string
  /** Set when the refund was already made in the Stripe dashboard, outside the app. */
  external?: boolean
}

interface AuditExtra {
  source?: 'admin' | 'stripe_external'
  note?: string | null
  currency?: string
}

interface ParticipantRow {
  id: string
  registration_id: string
  email: string
  first_name: string
  last_name: string
  member_id: string | null
  individual_payment_status: string | null
  stripe_payment_intent_id: string | null
}

// Issues the refund for a single paid participant under the money-back
// guarantee: everything left on the charge, within 45 days of payment, whether
// or not the event has happened; nothing after (lib/refunds/policy.ts). Returns
// a no-op ('none') for unpaid/free participants. Never throws on Stripe failure
// for the cash path — falls back to 'manual_required' and audits it.
//
// Before issuing anything it asks Stripe what has already been refunded, so a
// refund made by hand in the Stripe dashboard is never repeated (23 Sept 2026).
// The same answer carries the payment date the guarantee runs from.
export async function executeRefund(
  participantId: string,
  choice: RefundChoice,
  actorMemberId: string | null,
  note?: string | null,
  // Who asked: an admin in the delete dialog (the default), or the member or
  // organiser themselves (withdrawing, or removing a participant).
  opts: { actorType?: 'admin' | 'member' } = {},
): Promise<RefundResult> {
  const actorType = opts.actorType ?? 'admin'
  const db = supabaseServer()

  const { data: participant } = await db
    .from('participants')
    .select('id, registration_id, email, first_name, last_name, member_id, individual_payment_status, stripe_payment_intent_id')
    .eq('id', participantId)
    .maybeSingle()
  if (!participant) return { type: 'none', refundCents: 0, detail: 'Participant not found' }
  const p = participant as ParticipantRow

  const { data: reg } = await db
    .from('registrations')
    .select('event_slug, event_title, status, teacher_member_id')
    .eq('id', p.registration_id)
    .maybeSingle()
  if (!reg) return { type: 'none', refundCents: 0, detail: 'Registration not found' }

  const eventSlug = reg.event_slug as string
  const stripe = stripeClient()
  // Which payment covered this place and what it actually cost (after any
  // discount): lib/refunds/payment-basis.ts. Only hard payment evidence counts;
  // registrations.status='confirmed' is NOT proof of payment.
  const basis = await resolveRefundBasis(db, stripe, p)
  const paymentIntent = basis?.paymentIntent ?? null
  const isPaid = !!basis?.paid
  // Who to tell: a group's organiser paid for their students' places.
  const payerMemberId = basis?.payer === 'organiser' ? ((reg.teacher_member_id as string | null) ?? null) : p.member_id

  // Idempotency: never refund the same participant twice. limit(1), not
  // maybeSingle(): with two or more rows maybeSingle() errors, returns null,
  // and the participant read as "not refunded". 'credit' rows are from before
  // the guarantee, when a cancellation could be refunded as account credit.
  const { data: prior } = await db
    .from('event_refunds')
    .select('id')
    .eq('participant_id', participantId)
    .in('refund_type', ['cash', 'credit'])
    // A scholarship reimbursement is not a cancellation refund: the student is
    // still registered, and cancelling later still owes the guarantee refund on
    // what remains (Stripe's remaining-refundable cap applies below).
    .eq('kind', 'cancellation')
    .limit(1)
  if (prior && prior.length > 0) return { type: 'none', refundCents: 0, detail: 'Already refunded' }

  if (!isPaid) {
    await audit(db, p, eventSlug, { type: 'none', refundCents: 0, detail: 'Unpaid — nothing to refund' }, actorMemberId, 0)
    return { type: 'none', refundCents: 0, detail: 'Unpaid — nothing to refund' }
  }

  // What one place cost. What is left on the charge caps it below, so a
  // payment is never refunded more than it took.
  const paidCents = basis?.perPlaceCents ?? 0
  const currency = basis?.currency ?? 'usd'
  if (paidCents <= 0) {
    await audit(db, p, eventSlug, { type: 'none', refundCents: 0, detail: 'No fee on record' }, actorMemberId, 0, undefined, { note })
    return { type: 'none', refundCents: 0, detail: 'No fee on record' }
  }

  // What has Stripe already given back, and when was the payment taken?
  // Catches refunds made in the dashboard, which the app's own records don't
  // know about.
  const stripeState = paymentIntent ? await stripeRefundState(paymentIntent) : null
  if (isFullyRefunded(stripeState)) {
    const amount = `${(stripeState!.refundedCents / 100).toFixed(2)} ${stripeState!.currency.toUpperCase()}`
    const detail = `Already refunded ${amount} in Stripe — no further refund issued`
    const result: RefundResult = { type: 'none', refundCents: 0, detail, external: true }
    await audit(db, p, eventSlug, result, actorMemberId, paidCents, undefined, {
      source: 'stripe_external',
      note: [`Refunded ${amount} in Stripe outside the app`, note].filter(Boolean).join(' — '),
      currency: stripeState!.currency,
    })
    return result
  }

  if (choice === 'none') {
    const result: RefundResult = { type: 'none', refundCents: 0, detail: 'Removed without a refund' }
    await audit(db, p, eventSlug, result, actorMemberId, paidCents, undefined, { note, currency })
    if (p.member_id) {
      await logActivity({
        memberId: p.member_id,
        category: 'billing',
        action: 'refund_waived',
        summary: `Registration removed without a refund${note ? ` — ${note}` : ''}`,
        metadata: { participantId: p.id, eventSlug, paidCents },
        actorType,
        actorMemberId,
      }, db)
    }
    return result
  }

  // A partial refund already made in Stripe caps what's left to give back.
  const left = remainingCents(stripeState)
  const refundBasis = left === null ? paidCents : Math.min(paidCents, left)

  if (!paymentIntent || !stripe || !stripeState) {
    // Without Stripe's answer there is no payment date, so the guarantee can't
    // be checked — and no reference to refund against, or none we can read.
    const detail = !paymentIntent
      ? 'No Stripe payment reference (for example, an invoice paid by cheque) — check the payment date and refund by hand if within the guarantee'
      : 'Could not read the payment from Stripe — check its date and refund in Stripe if within the guarantee'
    await audit(db, p, eventSlug, { type: 'manual_required', refundCents: refundBasis, detail }, actorMemberId, paidCents, 100)
    await alertStaffIfUnattended(actorType, p, reg.event_title as string, detail)
    return { type: 'manual_required', refundCents: refundBasis, detail }
  }

  const option = guaranteeRefundOptions(stripeState.paidAt, refundBasis).cash
  if (!option) {
    const days = stripeState.paidAt ? daysSincePayment(stripeState.paidAt) : null
    const detail = days != null
      ? `Paid ${days} days ago — outside the ${GUARANTEE_DAYS}-day money-back guarantee, so no refund was issued`
      : 'Stripe has no payment date — no refund was issued'
    await audit(db, p, eventSlug, { type: 'none', refundCents: 0, detail }, actorMemberId, paidCents, undefined, { note: detail, currency })
    return { type: 'none', refundCents: 0, detail }
  }

  try {
    // Refuse to take money on a production deployment holding TEST keys. A test-mode
    // charge looks successful and settles nothing — the Stripe equivalent of the
    // DocuSign sandbox envelopes that were not binding signatures. Reads are
    // deliberately not gated: a wrong price is visible, a phantom payment is not.
    assertLiveCredentials('stripe')

    // metadata.source lets the charge.refunded webhook tell the app's own
    // refunds from ones made in the dashboard (it can arrive before we audit).
    //
    // deep review PAY-12: a stable idempotency key makes a retried or
    // double-submitted cancellation refund a no-op at Stripe — the second call
    // with the same key returns the first refund rather than issuing another.
    // This closes the read-then-act window (two admins, or a retry after the
    // audit/deletion failed mid-way) that could otherwise over-refund a group
    // payment. One refund per participant's cancellation, as the DB backstop
    // (event_refunds_one_cancellation_per_participant) also enforces. Matches
    // the scholarship refund path (lib/scholarship-refund.ts).
    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntent,
        amount: option.cents,
        metadata: { source: 'stellr_app', participant_id: p.id },
      },
      { idempotencyKey: `cancel-refund-${p.id}` },
    )
    const result: RefundResult = { type: 'cash', refundCents: option.cents, stripeRefundId: refund.id, detail: `Refunded ${(option.cents / 100).toFixed(2)} ${currency.toUpperCase()}` }
    await audit(db, p, eventSlug, result, actorMemberId, paidCents, option.pct, { currency })
    // A place paid by a Stripe invoice gets a credit note on that invoice, so
    // the organiser's records show the refund against what they paid.
    if (basis?.stripeInvoiceId) await creditNoteForRefund(stripe, basis.stripeInvoiceId, refund.id, option.cents, p)
    await notifyRefund(payerMemberId, p, reg.event_title as string, result, currency, basis?.payer ?? 'self')
    if (payerMemberId) {
      await logActivity({
        memberId: payerMemberId,
        category: 'billing',
        action: 'refund_issued',
        summary: `Cash refund issued — ${result.detail}`,
        metadata: { kind: 'cash', participantId: p.id, eventSlug, refundCents: option.cents },
        actorType,
        actorMemberId,
      }, db)
    }
    return result
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'Stripe refund failed'
    await audit(db, p, eventSlug, { type: 'manual_required', refundCents: option.cents, detail }, actorMemberId, paidCents, option.pct)
    await alertStaffIfUnattended(actorType, p, reg.event_title as string, detail)
    return { type: 'manual_required', refundCents: option.cents, detail }
  }
}

// An admin sees a refund that needs a hand in the delete dialog; a member or
// organiser withdrawing on their own does not, so staff are told.
async function alertStaffIfUnattended(actorType: 'admin' | 'member', p: ParticipantRow, eventTitle: string, detail: string) {
  if (actorType === 'admin') return
  await notifyCommunityAdmins({
    type: 'action',
    body: `A refund for ${p.first_name} ${p.last_name} (${eventTitle}) needs to be made by hand: ${detail}. See event_refunds for participant ${p.id}.`,
  }).catch(() => {})
}

async function audit(
  db: ReturnType<typeof supabaseServer>,
  p: ParticipantRow,
  eventSlug: string,
  result: RefundResult,
  actorMemberId: string | null,
  paidCents: number,
  refundPct?: number,
  extra: AuditExtra = {}
) {
  const { error } = await db.from('event_refunds').insert({
    participant_id: p.id,
    registration_id: p.registration_id,
    member_id: p.member_id,
    event_slug: eventSlug,
    paid_cents: paidCents,
    refund_type: result.type,
    refund_pct: refundPct ?? null,
    refund_cents: result.refundCents,
    // Columns from the days-before-the-event schedules; the guarantee uses neither.
    credit_validity_days: null,
    days_out: null,
    stripe_refund_id: result.stripeRefundId ?? null,
    account_credit_id: null,
    decided_by: actorMemberId,
    source: extra.source ?? 'admin',
    note: extra.note ?? (result.type === 'manual_required' ? result.detail : null),
    currency: extra.currency ?? null,
  })
  if (error) {
    // deep review PAY-12: a unique violation on
    // event_refunds_one_cancellation_per_participant means a cancellation refund
    // for this participant was already recorded — a concurrent/retried refund
    // raced us. That is the backstop working, not a failure: the money move is
    // already idempotency-keyed above, so log it benignly rather than as an error.
    if ((error as { code?: string }).code === '23505') {
      console.warn('[refunds] duplicate cancellation refund blocked by unique index:', { participantId: p.id })
    } else {
      console.error('[refunds] audit insert failed:', error.message, { participantId: p.id })
    }
  }
}

async function notifyRefund(
  payerMemberId: string | null,
  p: ParticipantRow,
  eventTitle: string,
  result: RefundResult,
  currency: string,
  payer: 'self' | 'organiser',
) {
  if (!payerMemberId) return
  const amount = `${(result.refundCents / 100).toFixed(2)} ${currency.toUpperCase()}`
  const body = payer === 'organiser'
    ? `A ${amount} refund was issued to your group's payment for ${p.first_name} ${p.last_name}'s place at ${eventTitle}.`
    : `A ${amount} refund was issued for your cancelled ${eventTitle} registration.`
  await notifyMember(payerMemberId, { type: 'action', body }).catch(() => {})
}

// Best-effort: the refund has already been made, so a failed credit note only
// costs the paper trail on the invoice. Linking the app's own refund (rather
// than letting the credit note create one) keeps metadata.source on it, which
// the charge.refunded webhook uses to tell app refunds from Dashboard ones.
async function creditNoteForRefund(
  stripe: ReturnType<typeof stripeClient>,
  invoiceId: string,
  refundId: string,
  cents: number,
  p: ParticipantRow,
) {
  if (!stripe) return
  try {
    await stripe.creditNotes.create({
      invoice: invoiceId,
      lines: [{ type: 'custom_line_item', description: 'Participant removed from the group', quantity: 1, unit_amount: cents }],
      refunds: [{ refund: refundId, amount_refunded: cents }],
      memo: 'Refund for one participant place under the money-back guarantee.',
      metadata: { source: 'stellr_app', participant_id: p.id },
    })
  } catch (e) {
    console.error('[refunds] credit note failed (refund already issued):', e instanceof Error ? e.message : e, { invoiceId, refundId })
  }
}
