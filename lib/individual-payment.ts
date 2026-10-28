import { randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { getEventBySlug } from '@/lib/sanity'
import {
  sendEmail,
  groupMemberIndividualPaymentEmail,
  groupRegisteredNoPaymentEmail,
} from '@/lib/email'
import { notifyCommunityAdmins } from '@/lib/notify'
import { assertLiveCredentials } from '@/lib/env-guards'
import { stripeClient } from '@/lib/stripe'
import { GUARANTEE_CHECKOUT_TEXT } from '@/lib/guarantee'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

export interface IndividualPaymentPerson {
  participantId: string
  email: string
  firstName: string
  lastName: string
}

export interface IndividualPaymentResult {
  charged: number
  waived: number
  skipped: number
}

// Every way a participant can join a "members pay individually" group must end
// with that person told what they owe — a Stripe checkout link, or (free event)
// a plain "you're registered, nothing to pay". Registration only ever did this
// inline in two of the five paths: the "add now" form branch and the join link.
// Anyone added via the linked Google Sheet or the organiser's manual add was
// left with individual_payment_status NULL, which meant no email, a self-serve
// payment endpoint that refused them, and — worst — a Stripe webhook that
// confirmed the whole registration once the *visible* 'pending' rows had paid.
//
// So it lives here, called from all five paths.
//
// deep review PAY-8: the email now links to a DURABLE per-seat pay page
// (seatPayPageUrl, keyed on participants.pay_token), which mints a fresh Checkout
// on click. Previously it embedded the raw Stripe Checkout URL, which expires in
// 24h, and individual_payment_link_sent_at was stamped so nothing re-sent it — a
// participant (often a sheet-added student with no member account, so Account →
// Teams was out of reach) who opened the email a day later hit "link expired"
// with no way back, and their seat stayed pending so the group never confirmed.
//
// Idempotent on participants.individual_payment_link_sent_at: a sheet re-sync or
// a replayed Drive webhook re-runs this for the same people and sends nothing.
// The stamp is written only AFTER a successful send, so a failed email is
// retried on the next sync rather than being silently lost (the old inline code
// stamped the status first, so a bounce was invisible and unrecoverable).
//
// Non-fatal throughout: a Stripe or Resend outage must never fail the
// registration or the sync that called it.
export async function ensureIndividualPayments(
  db: SupabaseClient,
  registrationId: string,
  people: IndividualPaymentPerson[],
): Promise<IndividualPaymentResult> {
  const empty: IndividualPaymentResult = { charged: 0, waived: 0, skipped: 0 }
  if (people.length === 0) return empty

  const { data: registration, error: regErr } = await db
    .from('registrations')
    .select('id, event_slug, event_title, member_pays_individually')
    .eq('id', registrationId)
    .maybeSingle()

  if (regErr) {
    console.error('[individual-payment] registration lookup failed (non-fatal):', regErr)
    return empty
  }
  // Not an individually-paid group — individual_payment_status stays NULL, which
  // is its existing "doesn't apply" meaning.
  if (!registration?.member_pays_individually) return empty

  const eventSlug = registration.event_slug as string
  const eventTitle = registration.event_title as string

  // Which of these people still need telling. Anyone already stamped was emailed
  // on a previous run.
  const { data: rows, error: rowsErr } = await db
    .from('participants')
    .select('id, individual_payment_link_sent_at')
    .in('id', people.map((p) => p.participantId))

  if (rowsErr) {
    console.error('[individual-payment] participant lookup failed (non-fatal):', rowsErr)
    return empty
  }

  const unsent = new Set(
    (rows ?? [])
      .filter((r) => r.individual_payment_link_sent_at == null)
      .map((r) => r.id as string),
  )
  const todo = people.filter((p) => unsent.has(p.participantId))
  if (todo.length === 0) return { ...empty, skipped: people.length }

  // A free event charges nothing and says so, rather than leaving everyone stuck
  // at 'pending' for a payment that can never be made. Free is either a blank
  // stripePriceId in Sanity or an explicit $0 price object — a $0 price would
  // otherwise mint checkout links Stripe can't create. A blank ID can equally
  // mean a paid event was misconfigured, and the two are indistinguishable here,
  // so the waive path alerts admins below.
  //
  // A price lookup that FAILS is deliberately not treated as free: unitAmount
  // stays null, we still send the pay link, and the per-person failure is
  // recorded. Waiving on a blip would tell paying participants they owe nothing.
  const event = await getEventBySlug(eventSlug).catch(() => null)
  const stripePriceId = (event as { stripePriceId?: string } | null)?.stripePriceId ?? null
  const stripe = stripeClient()
  let unitAmount: number | null = null
  if (stripePriceId && stripe) {
    try {
      unitAmount = (await stripe.prices.retrieve(stripePriceId)).unit_amount ?? null
    } catch (e) {
      console.error('[individual-payment] price lookup failed for', eventSlug, '—', stripePriceId, e)
    }
  }
  const canCharge = Boolean(stripePriceId && stripe) && unitAmount !== 0

  const outcomes = await Promise.all(
    todo.map((person) =>
      canCharge
        ? chargePerson(db, { registrationId, eventSlug, eventTitle }, person)
        : waivePerson(db, { registrationId, eventTitle }, person),
    ),
  )

  const charged = outcomes.filter((o) => o === 'charged').length
  const waived = outcomes.filter((o) => o === 'waived').length

  // One alert per batch that actually waived somebody — not per participant, and
  // never for a run that sent nothing. A genuinely free event produces a handful
  // of these; a paid event whose Price ID was never pasted into Sanity produces
  // one the moment the first group registers, which is the point.
  if (waived > 0) {
    await notifyCommunityAdmins({
      type: 'action',
      body: `${waived} participant${waived === 1 ? '' : 's'} on ${eventTitle} were registered with no payment required — the event has no registration fee. Confirm this event is intended to be free.`,
      referenceType: 'registration',
      referenceId: registrationId,
      email: {
        subject: `Check event pricing: ${eventTitle} registered ${waived} participant${waived === 1 ? '' : 's'} free`,
        html: `<p>A group registration for <strong>${eventTitle}</strong> is set to "members pay individually", but the event has no registration fee — either no Stripe Price ID in Sanity, or a $0 price.</p><p>${waived} participant${waived === 1 ? ' was' : 's were'} told no payment is required.</p><p>If this event is meant to be free, no action is needed. If not, set a paid Price ID in Sanity and follow up with the group.</p>`,
        text: `A group registration for ${eventTitle} is set to "members pay individually", but the event has no registration fee — either no Stripe Price ID in Sanity, or a $0 price. ${waived} participant(s) were told no payment is required. If the event is meant to be free, no action is needed — otherwise set a paid Price ID in Sanity and follow up with the group.`,
      },
    }).catch(() => {})
  }

  return { charged, waived, skipped: people.length - todo.length }
}

interface ChargeContext {
  registrationId: string
  eventSlug: string
  eventTitle: string
}

async function chargePerson(
  db: SupabaseClient,
  ctx: ChargeContext,
  person: IndividualPaymentPerson,
): Promise<'charged' | 'failed'> {
  try {
    // deep review PAY-8: email a durable per-seat pay link rather than a raw
    // 24h Checkout URL. The Checkout is minted on click (/api/register/pay-seat),
    // so the link keeps working — and it is settled by participant id (PAY-7).
    const token = await ensureSeatPayToken(db, person.participantId)

    // 'pending' before the send: it reflects what is owed, and the webhook's
    // "whole group paid?" check must see this person as outstanding from the
    // moment the link exists. The sent_at stamp (below) is what gates re-sending.
    await db
      .from('participants')
      .update({ individual_payment_status: 'pending' })
      .eq('id', person.participantId)

    await sendEmail({
      to: person.email,
      ...groupMemberIndividualPaymentEmail({
        memberFirstName: person.firstName,
        memberLastName: person.lastName,
        eventTitle: ctx.eventTitle,
        registrationId: ctx.registrationId,
        paymentUrl: seatPayPageUrl(ctx.eventSlug, token),
      }),
    })

    await stampSent(db, person.participantId)
    return 'charged'
  } catch (err) {
    console.error(`[individual-payment] pay-link setup failed for ${person.email} (non-fatal):`, err)
    return 'failed'
  }
}

async function waivePerson(
  db: SupabaseClient,
  ctx: { registrationId: string; eventTitle: string },
  person: IndividualPaymentPerson,
): Promise<'waived' | 'failed'> {
  try {
    await db
      .from('participants')
      .update({ individual_payment_status: 'waived' })
      .eq('id', person.participantId)

    await sendEmail({
      to: person.email,
      ...groupRegisteredNoPaymentEmail({
        memberFirstName: person.firstName,
        memberLastName: person.lastName,
        eventTitle: ctx.eventTitle,
        registrationId: ctx.registrationId,
      }),
    })

    await stampSent(db, person.participantId)
    return 'waived'
  } catch (err) {
    console.error(`[individual-payment] waive notice failed for ${person.email} (non-fatal):`, err)
    return 'failed'
  }
}

async function stampSent(db: SupabaseClient, participantId: string): Promise<void> {
  const { error } = await db
    .from('participants')
    .update({ individual_payment_link_sent_at: new Date().toISOString() })
    .eq('id', participantId)
  if (error) console.error('[individual-payment] sent_at stamp failed (non-fatal):', error)
}

// ── Per-seat pay token + checkout (deep review PAY-7 / PAY-8) ───────────────────

/** The durable per-seat pay page for `token`. Mirrors payPageUrl for registrations. */
export function seatPayPageUrl(eventSlug: string, token: string, opts?: { cancelled?: boolean }): string {
  return `${SITE_URL}/register/${eventSlug}/pay-seat/${token}${opts?.cancelled ? '?cancelled=1' : ''}`
}

/**
 * The participant's per-seat pay token, minting one if it has none. Mirrors
 * ensurePayToken for registrations: the `.is('pay_token', null)` guard keeps two
 * concurrent mints from clobbering each other — the loser re-reads the winner's.
 */
export async function ensureSeatPayToken(db: SupabaseClient, participantId: string): Promise<string> {
  const { data } = await db
    .from('participants')
    .select('pay_token')
    .eq('id', participantId)
    .maybeSingle()
  const existing = (data as { pay_token?: string | null } | null)?.pay_token
  if (existing) return existing

  const token = randomBytes(32).toString('hex')
  const { data: updated } = await db
    .from('participants')
    .update({ pay_token: token })
    .eq('id', participantId)
    .is('pay_token', null)
    .select('pay_token')
    .maybeSingle()
  const won = (updated as { pay_token?: string | null } | null)?.pay_token
  if (won) return won

  const { data: reread } = await db
    .from('participants')
    .select('pay_token')
    .eq('id', participantId)
    .maybeSingle()
  const current = (reread as { pay_token?: string | null } | null)?.pay_token
  if (!current) throw new Error(`Could not mint pay token for participant ${participantId}`)
  return current
}

export type SeatCheckoutError = { error: 'no_price' | 'free' }

export interface SeatCheckoutOptions {
  participantId: string
  participantEmail: string
  registrationId: string
  eventSlug: string
  successUrl: string
  cancelUrl: string
  /** Pre-fills Stripe's email field; omit/null to let the payer enter their own. */
  customerEmail?: string | null
}

/**
 * Mint a Stripe Checkout for one "members pay individually" seat. The single
 * place that builds a per-seat session, so the webhook-matching metadata is
 * identical everywhere: it carries BOTH participantId (deep review PAY-7 — the
 * webhook settles by id, because members.email follows Clerk while
 * participants.email is frozen at registration time) and participantEmail (the
 * fallback for sessions minted before PAY-7). Returns a {error} for a free / no-
 * price event rather than minting a $0 session Stripe would reject.
 */
export async function createSeatCheckout(
  stripe: Stripe,
  opts: SeatCheckoutOptions,
): Promise<{ url: string; sessionId: string } | SeatCheckoutError> {
  const event = await getEventBySlug(opts.eventSlug).catch(() => null)
  const stripePriceId = (event as { stripePriceId?: string } | null)?.stripePriceId ?? null
  if (!stripePriceId) return { error: 'no_price' }
  const price = await stripe.prices.retrieve(stripePriceId)
  if ((price.unit_amount ?? 0) <= 0) return { error: 'free' }

  // Refuse to take money on a production deployment holding TEST keys (same guard
  // as every other charge path). Reads above are not gated.
  assertLiveCredentials('stripe')

  const session = await stripe.checkout.sessions.create({
    // The money-back guarantee, on Stripe's page above the Pay button.
    custom_text: GUARANTEE_CHECKOUT_TEXT,
    mode: 'payment',
    // Surfaces the "Add promotion code" field for codes set up in Stripe.
    allow_promotion_codes: true,
    line_items: [{ price: stripePriceId, quantity: 1 }],
    ...(opts.customerEmail ? { customer_email: opts.customerEmail } : {}),
    customer_creation: 'always',
    client_reference_id: opts.registrationId,
    metadata: {
      registrationId: opts.registrationId,
      eventSlug: opts.eventSlug,
      participantId: opts.participantId,
      participantEmail: opts.participantEmail,
      isIndividualGroupPayment: 'true',
    },
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  })
  if (!session.url) throw new Error('Stripe seat checkout session has no URL')
  return { url: session.url, sessionId: session.id }
}
