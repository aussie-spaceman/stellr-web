import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import { registrationIsOpen } from '@/lib/registration'
import { rateLimitGuard } from '@/lib/rate-limit'
import { stripeClient } from '@/lib/stripe'
import { createSeatCheckout, seatPayPageUrl } from '@/lib/individual-payment'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

// POST /api/register/pay-seat  { token }
// Mints a Stripe Checkout for one "members pay individually" seat behind a
// per-participant pay token (deep review PAY-8). Unauthenticated by design — the
// token is the capability, and all it can do is open a checkout whose amount is
// fixed server-side. Mirrors /api/register/pay (the whole-registration pay link)
// so a sheet-added student with no member account always has a way back to pay.
export async function POST(req: NextRequest) {
  const limited = rateLimitGuard(req, 'register/pay-seat', { limit: 20, windowMs: 10 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return NextResponse.json({ error: 'This link isn’t valid.' }, { status: 404 })
  }

  const db = supabaseServer()
  const { data: partRow } = await db
    .from('participants')
    .select('id, email, registration_id, individual_payment_status')
    .eq('pay_token', token)
    .maybeSingle()
  const participant = partRow as {
    id: string
    email: string
    registration_id: string
    individual_payment_status: string | null
  } | null
  if (!participant) return NextResponse.json({ error: 'This link isn’t valid.' }, { status: 404 })

  if (participant.individual_payment_status === 'paid') {
    return NextResponse.json({ error: 'This seat is already paid.', code: 'already_paid' }, { status: 409 })
  }
  if (participant.individual_payment_status === 'waived') {
    return NextResponse.json({ error: 'There’s nothing to pay for this seat.', code: 'nothing_to_pay' }, { status: 409 })
  }

  const { data: regRow } = await db
    .from('registrations')
    .select('event_slug, event_title, member_pays_individually')
    .eq('id', participant.registration_id)
    .maybeSingle()
  const reg = regRow as { event_slug: string; event_title: string; member_pays_individually: boolean } | null
  if (!reg) return NextResponse.json({ error: 'This link isn’t valid.' }, { status: 404 })
  if (!reg.member_pays_individually) {
    return NextResponse.json({ error: 'This registration isn’t paid per person.', code: 'not_individual' }, { status: 409 })
  }

  const event = await getEventBySlug(reg.event_slug).catch(() => null)
  if (event && !registrationIsOpen(event)) {
    return NextResponse.json({ error: 'Registration for this event has closed.' }, { status: 403 })
  }

  const stripe = stripeClient()
  if (!stripe) return NextResponse.json({ error: 'Payments are not configured.' }, { status: 503 })

  try {
    const result = await createSeatCheckout(stripe, {
      participantId: participant.id,
      participantEmail: participant.email,
      registrationId: participant.registration_id,
      eventSlug: reg.event_slug,
      // The payer is often a parent who isn't signed in — let them enter their own
      // email for the receipt (same choice as the registration pay page).
      customerEmail: null,
      successUrl: `${SITE_URL}/register/${reg.event_slug}/confirmation?id=${participant.registration_id}&type=group&payment=success`,
      cancelUrl: seatPayPageUrl(reg.event_slug, token, { cancelled: true }),
    })
    if ('error' in result) {
      return result.error === 'free'
        ? NextResponse.json({ error: 'There’s nothing to pay for this seat.', code: 'nothing_to_pay' }, { status: 409 })
        : NextResponse.json({ error: 'This event’s fee is misconfigured — please contact Stellr.', code: 'no_price' }, { status: 503 })
    }
    return NextResponse.json({ url: result.url })
  } catch (e) {
    console.error('[register/pay-seat] checkout create failed:', e)
    return NextResponse.json({ error: 'Payment could not be started. Please try again shortly.' }, { status: 502 })
  }
}
