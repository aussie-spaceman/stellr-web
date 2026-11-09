import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import { rateLimit } from '@/lib/rate-limit-async'
import { requestTenant } from '@/lib/tenancy/request-tenant'
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
// it can do is open a checkout whose amount is fixed server-side. The link works
// whether or not the event's registration is still open: closing registration
// stops new sign-ups, not payment for a place someone already holds.
export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, 'register/pay', { limit: 20, windowMs: 10 * 60_000, tenantId: (await requestTenant()).tenantId })
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

  // Fail closed, as the registration routes do: without the event the fee can't
  // be known. An outage is retryable; an event that no
  // longer resolves needs a person, the same answer as an event with no price.
  let event
  try {
    event = await getEventBySlug(reg.event_slug)
  } catch (e) {
    console.error('[register/pay] event lookup failed:', e)
    return NextResponse.json({ error: 'Payment could not be started. Please try again shortly.' }, { status: 503 })
  }
  if (!event) {
    return NextResponse.json(
      { error: 'This event’s registration fee is misconfigured — please contact Stellr.', code: 'no_price' },
      { status: 503 },
    )
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
      event: event as { stripePriceId?: string },
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
