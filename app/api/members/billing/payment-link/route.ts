import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'

const APP_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

// POST /api/members/billing/payment-link  { registrationId }
// Creates a Stripe checkout for an outstanding event payment the SIGNED-IN
// member is responsible for — an individual registration, or a group
// registration where the member pays their own share. Group payments owned by
// an organiser are NOT payable here (the organiser settles their invoice).
export async function POST(req: NextRequest) {
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
    ? registration.status !== 'confirmed' && registration.status !== 'cancelled'
    : registration.member_pays_individually && participant.individual_payment_status === 'pending'
  if (!selfPayable) {
    return NextResponse.json({ error: 'No payment is due from you for this registration.' }, { status: 400 })
  }

  const stripe = getStripe()
  if (!stripe) return NextResponse.json({ error: 'Payments not configured' }, { status: 503 })

  const event = await getEventBySlug(registration.event_slug)
  const stripePriceId = (event as { stripePriceId?: string } | null)?.stripePriceId
  if (!stripePriceId) return NextResponse.json({ error: 'No price configured for this event' }, { status: 400 })

  // Metadata mirrors the registration checkouts so the existing Stripe webhook
  // settles the right thing: individual → confirmRegistration (registrationId /
  // client_reference_id); member-pays-individually → markIndividualPayment.
  const metadata: Record<string, string> = isIndividual
    ? { registrationId, eventSlug: registration.event_slug }
    : { registrationId, eventSlug: registration.event_slug, participantEmail: member.email, isIndividualGroupPayment: 'true' }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
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
