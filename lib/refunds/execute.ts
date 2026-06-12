import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import { notifyMember } from '@/lib/notify'
import { stripeClient } from './stripe'
import { resolvePolicy, applicableTier, computeRefundOptions, daysOut } from './policy'

export type RefundChoice = 'cash' | 'credit'

export interface RefundResult {
  type: 'cash' | 'credit' | 'manual_required' | 'none'
  refundCents: number
  stripeRefundId?: string
  creditId?: string
  detail: string
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

// Issues the refund for a single paid participant per the event's refund policy.
// Returns a no-op ('none') for unpaid/free participants. Never throws on Stripe
// failure for the cash path — falls back to 'manual_required' and audits it.
export async function executeRefund(
  participantId: string,
  choice: RefundChoice,
  actorMemberId: string | null
): Promise<RefundResult> {
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
    .select('event_slug, event_title, status, stripe_payment_intent_id')
    .eq('id', p.registration_id)
    .maybeSingle()
  if (!reg) return { type: 'none', refundCents: 0, detail: 'Registration not found' }

  const eventSlug = reg.event_slug as string
  // Only hard payment evidence counts: a webhook-recorded per-participant
  // payment or a stored payment_intent. registrations.status='confirmed' is NOT
  // proof of payment (test data / manual edits can confirm without money moving).
  // Historical group payments with no stored intent fall through to "unpaid" —
  // those are handled manually rather than risking a phantom refund.
  const paymentIntent = p.stripe_payment_intent_id ?? (reg.stripe_payment_intent_id as string | null)
  const isPaid = p.individual_payment_status === 'paid' || !!paymentIntent

  // Idempotency: never refund the same participant twice.
  const { data: prior } = await db
    .from('event_refunds')
    .select('id')
    .eq('participant_id', participantId)
    .in('refund_type', ['cash', 'credit'])
    .maybeSingle()
  if (prior) return { type: 'none', refundCents: 0, detail: 'Already refunded' }

  if (!isPaid) {
    await audit(db, p, eventSlug, { type: 'none', refundCents: 0, detail: 'Unpaid — nothing to refund' }, actorMemberId, 0, null, null)
    return { type: 'none', refundCents: 0, detail: 'Unpaid — nothing to refund' }
  }

  // Resolve amount paid (per-student unit price) + currency from the event's Stripe Price.
  const event = await getEventBySlug(eventSlug) as { date?: string; stripePriceId?: string } | null
  const stripe = stripeClient()
  let paidCents = 0
  let currency = 'usd'
  if (event?.stripePriceId && stripe) {
    try {
      const price = await stripe.prices.retrieve(event.stripePriceId)
      paidCents = price.unit_amount ?? 0
      currency = price.currency ?? 'usd'
    } catch {
      /* fall through with 0 — treated as nothing to refund */
    }
  }
  if (paidCents <= 0 || !event?.date) {
    await audit(db, p, eventSlug, { type: 'none', refundCents: 0, detail: 'No fee on record' }, actorMemberId, 0, null, null)
    return { type: 'none', refundCents: 0, detail: 'No fee on record' }
  }

  const tiers = await resolvePolicy(eventSlug)
  const tier = applicableTier(tiers, event.date)
  const options = computeRefundOptions(tier, paidCents)
  const d = daysOut(event.date)

  const chosen = options[choice]
  if (!chosen) {
    // Requested option isn't offered at this tier — pick whatever is available.
    const fallback = options.cash ?? options.credit
    if (!fallback) {
      await audit(db, p, eventSlug, { type: 'none', refundCents: 0, detail: 'No refund due at this tier' }, actorMemberId, paidCents, tier?.creditValidityDays ?? null, d)
      return { type: 'none', refundCents: 0, detail: 'No refund due at this tier' }
    }
    choice = options.cash === fallback ? 'cash' : 'credit'
  }
  const option = options[choice]!

  if (choice === 'cash') {
    if (!paymentIntent || !stripe) {
      await audit(db, p, eventSlug, { type: 'manual_required', refundCents: option.cents, detail: 'No Stripe payment reference — refund manually' }, actorMemberId, paidCents, null, d, option.pct)
      return { type: 'manual_required', refundCents: option.cents, detail: 'No Stripe payment reference — refund manually in Stripe' }
    }
    try {
      const refund = await stripe.refunds.create({ payment_intent: paymentIntent, amount: option.cents })
      const result: RefundResult = { type: 'cash', refundCents: option.cents, stripeRefundId: refund.id, detail: `Refunded ${(option.cents / 100).toFixed(2)} ${currency.toUpperCase()}` }
      await audit(db, p, eventSlug, result, actorMemberId, paidCents, null, d, option.pct)
      await notifyRefund(p, reg.event_title as string, result, currency)
      return result
    } catch (e) {
      const detail = e instanceof Error ? e.message : 'Stripe refund failed'
      await audit(db, p, eventSlug, { type: 'manual_required', refundCents: option.cents, detail }, actorMemberId, paidCents, null, d, option.pct)
      return { type: 'manual_required', refundCents: option.cents, detail }
    }
  }

  // Credit
  const memberId = p.member_id ?? (await memberIdByEmail(db, p.email))
  if (!memberId) {
    await audit(db, p, eventSlug, { type: 'manual_required', refundCents: option.cents, detail: 'No member account to credit' }, actorMemberId, paidCents, option.validityDays ?? null, d, option.pct)
    return { type: 'manual_required', refundCents: option.cents, detail: 'No member account to hold the credit' }
  }
  const expiresAt = option.validityDays
    ? new Date(Date.now() + option.validityDays * 86_400_000).toISOString()
    : null
  const { data: credit } = await db
    .from('account_credits')
    .insert({
      member_id: memberId,
      currency,
      amount_cents: option.cents,
      remaining_cents: option.cents,
      source_type: 'registration_refund',
      source_participant_id: p.id,
      source_registration_id: p.registration_id,
      reason: `Refund credit for ${reg.event_title}`,
      expires_at: expiresAt,
    })
    .select('id')
    .single()

  const result: RefundResult = { type: 'credit', refundCents: option.cents, creditId: credit?.id, detail: `Issued ${(option.cents / 100).toFixed(2)} ${currency.toUpperCase()} credit` }
  await audit(db, p, eventSlug, result, actorMemberId, paidCents, option.validityDays ?? null, d, option.pct)
  await notifyRefund(p, reg.event_title as string, result, currency)
  return result
}

async function memberIdByEmail(db: ReturnType<typeof supabaseServer>, email: string): Promise<string | null> {
  const { data } = await db.from('members').select('id').eq('email', email).maybeSingle()
  return (data?.id as string | undefined) ?? null
}

async function audit(
  db: ReturnType<typeof supabaseServer>,
  p: ParticipantRow,
  eventSlug: string,
  result: RefundResult,
  actorMemberId: string | null,
  paidCents: number,
  creditValidityDays: number | null,
  daysOutVal: number | null,
  refundPct?: number
) {
  await db.from('event_refunds').insert({
    participant_id: p.id,
    registration_id: p.registration_id,
    member_id: p.member_id,
    event_slug: eventSlug,
    paid_cents: paidCents,
    refund_type: result.type,
    refund_pct: refundPct ?? null,
    refund_cents: result.refundCents,
    credit_validity_days: creditValidityDays,
    days_out: daysOutVal,
    stripe_refund_id: result.stripeRefundId ?? null,
    account_credit_id: result.creditId ?? null,
    decided_by: actorMemberId,
  })
}

async function notifyRefund(p: ParticipantRow, eventTitle: string, result: RefundResult, currency: string) {
  if (!p.member_id) return
  const amount = `${(result.refundCents / 100).toFixed(2)} ${currency.toUpperCase()}`
  const body =
    result.type === 'credit'
      ? `A ${amount} account credit was issued for your cancelled ${eventTitle} registration.`
      : `A ${amount} refund was issued for your cancelled ${eventTitle} registration.`
  await notifyMember(p.member_id, { type: 'action', body }).catch(() => {})
}
