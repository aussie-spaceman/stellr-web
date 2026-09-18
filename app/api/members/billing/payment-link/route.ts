import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import { assertNotImpersonating } from '@/lib/impersonation'
import { assertLiveCredentials } from '@/lib/env-guards'
import { stripeClient } from '@/lib/stripe'
import { createRegistrationCheckout, RegistrationCheckoutError } from '@/lib/registration-checkout'

const APP_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

// POST /api/members/billing/payment-link  { registrationId }
// Creates a Stripe checkout for an outstanding event payment the SIGNED-IN
// member is responsible for — an individual registration, or a group
// registration where the member pays their own share. Group payments owned by
// an organiser are NOT payable here (the organiser settles their invoice).
export async function POST(req: NextRequest) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — see lib/impersonation.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { registrationId } = await req.json().catch(() => ({})) as { registrationId?: string }
  if (!registrationId) return NextResponse.json({ error: 'registrationId required' }, { status: 400 })

  const db = supabaseServer()

  const { data: member } = await db
    .from('members')
    .select('id, email')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const { data: registration } = await db
    .from('registrations')
    .select('event_slug, event_title, type, status, member_pays_individually')
    .eq('id', registrationId)
    .maybeSingle()
  if (!registration) return NextResponse.json({ error: 'Registration not found' }, { status: 404 })

  const { data: participant } = await db
    .from('participants')
    .select('id, individual_payment_status')
    .eq('registration_id', registrationId)
    .eq('member_id', member.id)
    .maybeSingle()
  if (!participant) return NextResponse.json({ error: 'You are not part of this registration' }, { status: 403 })

  // Only the member's OWN outstanding payment is payable here.
  const isIndividual = registration.type === 'individual'
  const selfPayable = isIndividual
    ? registration.status === 'pending'
    : registration.member_pays_individually && participant.individual_payment_status === 'pending'
  if (!selfPayable) {
    return NextResponse.json({ error: 'No payment is due from you for this registration.' }, { status: 400 })
  }

  const stripe = stripeClient()
  if (!stripe) return NextResponse.json({ error: 'Payments not configured' }, { status: 503 })

  // Individual: the same checkout the registration form and pay page build —
  // fee plus any pending merch add-ons, metadata the webhook already matches.
  if (isIndividual) {
    try {
      const { url } = await createRegistrationCheckout(db, stripe, registrationId, {
        customerEmail: member.email,
        successUrl: `${APP_URL}/account?tab=billing&paid=1`,
        cancelUrl: `${APP_URL}/account?tab=billing`,
      })
      return NextResponse.json({ url })
    } catch (e) {
      if (e instanceof RegistrationCheckoutError) {
        const status = e.code === 'no_price' ? 503 : 400
        return NextResponse.json({ error: e.code === 'nothing_to_pay' ? 'No payment is due from you for this registration.' : e.message }, { status })
      }
      throw e
    }
  }

  const event = await getEventBySlug(registration.event_slug)
  const stripePriceId = (event as { stripePriceId?: string } | null)?.stripePriceId
  if (!stripePriceId) return NextResponse.json({ error: 'No price configured for this event' }, { status: 400 })

  // Member-pays-individually: metadata mirrors lib/individual-payment so the
  // webhook's markIndividualPayment settles this member's seat.
  const metadata: Record<string, string> = {
    registrationId, eventSlug: registration.event_slug, participantEmail: member.email, isIndividualGroupPayment: 'true',
  }

  // Refuse to take money on a production deployment holding TEST keys. A test-mode
  // charge looks successful and settles nothing — the Stripe equivalent of the
  // DocuSign sandbox envelopes that were not binding signatures. Reads are
  // deliberately not gated: a wrong price is visible, a phantom payment is not.
  assertLiveCredentials('stripe')

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    // Surfaces the "Add promotion code" field for codes set up in Stripe.
    allow_promotion_codes: true,
    line_items: [{ price: stripePriceId, quantity: 1 }],
    client_reference_id: registrationId,
    customer_email: member.email,
    customer_creation: 'always',
    metadata,
    success_url: `${APP_URL}/account?tab=billing&paid=1`,
    cancel_url: `${APP_URL}/account?tab=billing`,
  })

  return NextResponse.json({ url: session.url })
}
