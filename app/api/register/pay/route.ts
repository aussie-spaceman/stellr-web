import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import { registrationIsOpen } from '@/lib/registration'
import { rateLimitGuard } from '@/lib/rate-limit'
import { stripeClient } from '@/lib/stripe'
import {
  createRegistrationCheckout,
  RegistrationCheckoutError,
  payPageUrl,
} from '@/lib/registration-checkout'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

// POST /api/register/pay  { token }
// Mints a Stripe Checkout for the pending registration behind a pay token.
// Unauthenticated by design — the token is the capability, and the only thing
// it can do is open a checkout whose amount is fixed server-side.
export async function POST(req: NextRequest) {
  const limited = rateLimitGuard(req, 'register/pay', { limit: 20, windowMs: 10 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return NextResponse.json({ error: 'This link isn’t valid.' }, { status: 404 })
  }

  const db = supabaseServer()
  const { data: regRow } = await db
    .from('registrations')
    .select('id, event_slug, type, status')
    .eq('pay_token', token)
    .maybeSingle()
  const reg = regRow as { id: string; event_slug: string; type: string; status: string } | null
  if (!reg) return NextResponse.json({ error: 'This link isn’t valid.' }, { status: 404 })
  if (reg.status === 'confirmed') {
    return NextResponse.json({ error: 'This registration is already paid.', code: 'already_paid' }, { status: 409 })
  }
  if (reg.status !== 'pending') {
    return NextResponse.json({ error: 'This registration has no payment outstanding.', code: 'not_pending' }, { status: 409 })
  }

  const event = await getEventBySlug(reg.event_slug).catch(() => null)
  if (event && !registrationIsOpen(event)) {
    return NextResponse.json({ error: 'Registration for this event has closed.' }, { status: 403 })
  }

  const stripe = stripeClient()
  if (!stripe) return NextResponse.json({ error: 'Payments are not configured.' }, { status: 503 })

  // Land on the public confirmation page, not the member portal: the payer is
  // often a parent who isn't signed in as the registrant.
  const successUrl =
    reg.type === 'individual'
      ? `${SITE_URL}/register/${reg.event_slug}/confirmation?id=${reg.id}&type=individual&payment=success`
      : `${SITE_URL}/register/${reg.event_slug}/confirmation?id=${reg.id}&type=group&payment=success`

  try {
    const { url } = await createRegistrationCheckout(db, stripe, reg.id, {
      event: event as { stripePriceId?: string } | null,
      customerEmail: null,
      successUrl,
      cancelUrl: payPageUrl(reg.event_slug, token, { cancelled: true }),
    })
    return NextResponse.json({ url })
  } catch (e) {
    if (e instanceof RegistrationCheckoutError) {
      const status =
        e.code === 'not_found' ? 404
        : e.code === 'not_pending' ? 409
        : e.code === 'no_price' ? 503
        : 400
      const error =
        e.code === 'nothing_to_pay'
          ? 'There’s nothing left to pay on this registration. Reply to your registration email if you think that’s wrong.'
          : e.code === 'no_price'
            ? 'This event’s registration fee is misconfigured — please contact Stellr.'
            : e.message
      return NextResponse.json({ error, code: e.code }, { status })
    }
    console.error('[register/pay] checkout create failed:', e)
    return NextResponse.json({ error: 'Payment could not be started. Please try again shortly.' }, { status: 502 })
  }
}
