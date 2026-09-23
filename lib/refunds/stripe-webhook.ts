import type Stripe from 'stripe'
import type { supabaseServer } from '@/lib/supabase'

type Db = ReturnType<typeof supabaseServer>

// charge.refunded — records refunds made in the Stripe dashboard against the
// event registration they paid for, so the app knows about them (23 Sept 2026:
// a manual full refund was invisible, and deleting the registration would have
// refunded it a second time).
//
// It only records. Registration status and individual_payment_status stay as
// they are: removing the person is still the admin's decision, made in the
// delete dialog, which will then issue nothing further.
//
// Idempotent: event_refunds.stripe_refund_id is unique, so a redelivery (or a
// later refund on the same charge, which re-sends every refund) inserts only
// the new ones. Refunds the app itself made carry metadata.source='stellr_app'
// and are skipped — the delete flow audits those.
export async function recordExternalChargeRefunds(
  db: Db,
  stripe: Stripe,
  charge: Stripe.Charge
): Promise<{ recorded: number; reason?: string }> {
  const paymentIntent = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
  if (!paymentIntent) return { recorded: 0, reason: 'no payment_intent' }

  const target = await findRegistrationTarget(db, paymentIntent)
  // Not an event registration payment (store order, membership, booking…).
  if (!target) return { recorded: 0, reason: 'not an event registration payment' }

  const refunds = await stripe.refunds.list({ charge: charge.id, limit: 100 })
  const rows = refunds.data
    .filter((r) => r.status === 'succeeded' || r.status === 'pending')
    .filter((r) => r.metadata?.source !== 'stellr_app')
    .map((r) => ({
      participant_id: target.participantId,
      registration_id: target.registrationId,
      member_id: target.memberId,
      event_slug: target.eventSlug,
      paid_cents: charge.amount,
      refund_type: 'cash',
      refund_cents: r.amount,
      stripe_refund_id: r.id,
      decided_by: null,
      source: 'stripe_external',
      currency: r.currency,
      note: `Refunded in Stripe outside the app${r.reason ? ` (${r.reason})` : ''}`,
    }))
  if (rows.length === 0) return { recorded: 0, reason: 'no external refunds' }

  const { error } = await db
    .from('event_refunds')
    .upsert(rows, { onConflict: 'stripe_refund_id', ignoreDuplicates: true })
  if (error) throw new Error(`event_refunds upsert failed: ${error.message}`)
  return { recorded: rows.length }
}

interface Target {
  registrationId: string
  /** Null when one payment covered several people (a group payment). */
  participantId: string | null
  memberId: string | null
  eventSlug: string | null
}

// The payment_intent lands on the participant for a per-person payment, or on
// the registration for a whole-group/individual one (see capturePaymentIntent).
async function findRegistrationTarget(db: Db, paymentIntent: string): Promise<Target | null> {
  const { data: parts } = await db
    .from('participants')
    .select('id, registration_id, member_id')
    .eq('stripe_payment_intent_id', paymentIntent)
  let people = (parts ?? []) as { id: string; registration_id: string; member_id: string | null }[]
  let registrationId: string | null = people[0]?.registration_id ?? null

  if (!registrationId) {
    const { data: reg } = await db
      .from('registrations')
      .select('id')
      .eq('stripe_payment_intent_id', paymentIntent)
      .limit(1)
    registrationId = (reg?.[0]?.id as string | undefined) ?? null
    if (!registrationId) return null
    const { data: regParts } = await db
      .from('participants')
      .select('id, registration_id, member_id')
      .eq('registration_id', registrationId)
    people = (regParts ?? []) as typeof people
  }

  const regId: string = registrationId
  const { data: reg } = await db.from('registrations').select('event_slug').eq('id', regId).maybeSingle()
  const only = people.length === 1 ? people[0] : null
  return {
    registrationId: regId,
    participantId: only?.id ?? null,
    memberId: only?.member_id ?? null,
    eventSlug: (reg?.event_slug as string | undefined) ?? null,
  }
}
