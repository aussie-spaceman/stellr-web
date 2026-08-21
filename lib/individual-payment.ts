import type { SupabaseClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { getEventBySlug } from '@/lib/sanity'
import {
  sendEmail,
  groupMemberIndividualPaymentEmail,
  groupRegisteredNoPaymentEmail,
} from '@/lib/email'
import { notifyCommunityAdmins } from '@/lib/notify'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

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
  // stays null, we still attempt the charge, and the per-person failure is
  // recorded. Waiving on a blip would tell paying participants they owe nothing.
  const event = await getEventBySlug(eventSlug).catch(() => null)
  const stripePriceId = (event as { stripePriceId?: string } | null)?.stripePriceId ?? null
  const stripe = getStripe()
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
        ? chargePerson(db, stripe!, stripePriceId!, { registrationId, eventSlug, eventTitle }, person)
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
  stripe: Stripe,
  stripePriceId: string,
  ctx: ChargeContext,
  person: IndividualPaymentPerson,
): Promise<'charged' | 'failed'> {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: stripePriceId, quantity: 1 }],
      customer_email: person.email,
      // The webhook matches on these to mark the right participant paid.
      metadata: {
        registrationId: ctx.registrationId,
        eventSlug: ctx.eventSlug,
        participantEmail: person.email,
        isIndividualGroupPayment: 'true',
      },
      success_url: `${SITE_URL}/register/${ctx.eventSlug}/confirmation?id=${ctx.registrationId}&type=group&payment=success`,
      cancel_url: `${SITE_URL}/account?tab=teams`,
    })
    if (!session.url) {
      console.error('[individual-payment] checkout session has no URL for', person.email)
      return 'failed'
    }

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
        paymentUrl: session.url,
      }),
    })

    await stampSent(db, person.participantId)
    return 'charged'
  } catch (err) {
    console.error(`[individual-payment] charge setup failed for ${person.email} (non-fatal):`, err)
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
