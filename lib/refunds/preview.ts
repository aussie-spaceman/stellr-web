import { supabaseServer } from '@/lib/supabase'
import { stripeClient } from '@/lib/stripe'
import { GUARANTEE_DAYS, daysSincePayment, guaranteeRefundOptions, type RefundOptions } from './policy'
import { stripeRefundState, isFullyRefunded, remainingCents } from './stripe-state'
import { resolveRefundBasis } from './payment-basis'
import { loadRecord, refuseUnlessStellrEvent } from '@/lib/tenancy/load-scoped'
import { isStellrScope, type ScopeContext } from '@/lib/tenancy/scope-context'

export interface RefundPreview {
  paid: boolean
  paidCents: number
  currency: string
  /** Whole days since the charge, or null when Stripe couldn't say. */
  daysSincePayment: number | null
  /** The guarantee window, for the dialog's wording. */
  guaranteeDays: number
  options: RefundOptions
  hasPaymentRef: boolean // false => cash refund would need manual handling
  alreadyRefunded: boolean
  /**
   * A refund made in the Stripe dashboard, outside the app. When `full`, no
   * refund is offered and the delete records it; when partial, the
   * options are already capped at what is left on the charge.
   */
  externalRefund: { refundedCents: number; currency: string; full: boolean } | null
}

/** The preview for a participant with nothing to refund, who does not exist, or who is out of reach. */
export const EMPTY_REFUND_PREVIEW: RefundPreview = { paid: false, paidCents: 0, currency: 'usd', daysSincePayment: null, guaranteeDays: GUARANTEE_DAYS, options: {}, hasPaymentRef: false, alreadyRefunded: false, externalRefund: null }

type PreviewParticipant = Parameters<typeof resolveRefundBasis>[2] & { id: string }
const PREVIEW_COLUMNS = 'id, registration_id, individual_payment_status, stripe_payment_intent_id, payer, base_paid_cents, share_paid_cents'

// Read-only computation of what a participant deletion would refund, for the
// admin delete dialog. Mirrors executeRefund's resolution without mutating. With a
// scope, a participant outside it answers as one that does not exist.
export async function previewRefund(participantId: string, scope?: ScopeContext): Promise<RefundPreview> {
  const db = supabaseServer()
  const p = await loadPreviewParticipant(db, participantId, scope)
  if (!p) return EMPTY_REFUND_PREVIEW
  return previewFor(db, participantId, p)
}

/**
 * previewRefund for the admin delete dialog, which reads Stellr's Stripe account. After the
 * participant load, the event their place is on must be Stellr's: another tenant's event gets
 * refuseUnlessStellrEvent's 404, and a failed read of the event's owner its retryable 503, both
 * before anything reads the payment. A participant out of reach, or whose registration cannot
 * be read, is the empty preview, as in previewRefund. Another tenant's own scope is empty
 * before this check, so only Stellr's scope makes the two extra reads.
 */
export async function previewRefundOnStellrEvent(participantId: string, scope: ScopeContext, label: string): Promise<RefundPreview | Response> {
  const db = supabaseServer()
  const p = await loadPreviewParticipant(db, participantId, scope)
  if (!p) return EMPTY_REFUND_PREVIEW
  const reg = await loadRecord<{ event_slug: string }>(scope, 'registrations', p.registration_id, {
    db,
    select: 'event_slug',
    notFound: () => new Response(null, { status: 404 }),
    label,
  })
  if (!reg.ok) return EMPTY_REFUND_PREVIEW
  const foreign = await refuseUnlessStellrEvent(db, reg.row.event_slug, label)
  if (foreign) return foreign
  return previewFor(db, participantId, p)
}

type Db = ReturnType<typeof supabaseServer>

/** The participant, or null when there is none, it is outside the scope, or the scope is another tenant's. */
async function loadPreviewParticipant(db: Db, participantId: string, scope?: ScopeContext): Promise<PreviewParticipant | null> {
  let p: PreviewParticipant | null
  if (scope) {
    const loaded = await loadRecord<PreviewParticipant>(scope, 'participants', participantId, {
      db,
      select: PREVIEW_COLUMNS,
      notFound: () => new Response(null, { status: 404 }),
      label: 'previewRefund',
    })
    p = loaded.ok ? loaded.row : null
  } else {
    const { data } = await db.from('participants').select(PREVIEW_COLUMNS).eq('id', participantId).maybeSingle()
    p = data as PreviewParticipant | null
  }
  if (!p) return null
  // A tenant's event takes no payment yet, and Stripe here is Stellr's account.
  if (scope && !isStellrScope(scope)) return null
  return p
}

async function previewFor(db: Db, participantId: string, p: PreviewParticipant): Promise<RefundPreview> {
  const empty = EMPTY_REFUND_PREVIEW

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
  // limit(1), not maybeSingle(): two or more rows made maybeSingle() error and
  // the participant read as "not refunded".
  const alreadyRefunded = !!prior && prior.length > 0

  // Same resolution as executeRefund: which payment covered this place, and
  // what the place actually cost after any discount (lib/refunds/payment-basis.ts).
  const stripe = stripeClient()
  const basis = await resolveRefundBasis(db, stripe, p)
  if (!basis) return empty
  const paymentIntent = basis.paymentIntent
  if (!basis.paid) return { ...empty, alreadyRefunded }

  const paidCents = basis.perPlaceCents
  const currency = basis.currency
  if (paidCents <= 0) {
    return { ...empty, paid: true, currency, hasPaymentRef: !!paymentIntent, alreadyRefunded }
  }

  // Ask Stripe directly: a refund made in the dashboard never reaches our tables.
  const stripeState = paymentIntent && !alreadyRefunded ? await stripeRefundState(paymentIntent) : null
  const externalRefund = stripeState && stripeState.refundedCents > 0
    ? { refundedCents: stripeState.refundedCents, currency: stripeState.currency, full: isFullyRefunded(stripeState) }
    : null
  const left = remainingCents(stripeState)
  const refundBasis = left === null ? paidCents : Math.min(paidCents, left)

  // The guarantee runs from the charge's date, which only Stripe knows: with no
  // answer from Stripe nothing is offered, and the dialog says why.
  const paidAt = stripeState?.paidAt ?? null
  return {
    paid: true,
    paidCents,
    currency,
    daysSincePayment: paidAt ? daysSincePayment(paidAt) : null,
    guaranteeDays: GUARANTEE_DAYS,
    options: externalRefund?.full || alreadyRefunded ? {} : guaranteeRefundOptions(paidAt, refundBasis),
    hasPaymentRef: !!paymentIntent,
    alreadyRefunded,
    externalRefund,
  }
}
