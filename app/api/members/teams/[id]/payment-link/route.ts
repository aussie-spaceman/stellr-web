import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

// POST /api/members/teams/[id]/payment-link
// Creates a fresh Stripe checkout session for a member with a pending individual payment.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id: registrationId } = await params
  const db = supabaseServer()

  const { data: member } = await db
    .from('members')
    .select('id, email, first_name, last_name')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  // Find the participant row for this member in this registration
  const { data: participant } = await db
    .from('participants')
    .select('id, individual_payment_status')
    .eq('registration_id', registrationId)
    .eq('member_id', member.id)
    .maybeSingle()

  if (!participant) return NextResponse.json({ error: 'You are not part of this team' }, { status: 403 })
  if (participant.individual_payment_status !== 'pending') {
    return NextResponse.json({ error: 'No payment required' }, { status: 400 })
  }

  // Load registration to get event slug
  const { data: registration } = await db
    .from('registrations')
    .select('event_slug, event_title')
    .eq('id', registrationId)
    .maybeSingle()

  if (!registration) return NextResponse.json({ error: 'Registration not found' }, { status: 404 })

  const stripe = getStripe()
  if (!stripe) return NextResponse.json({ error: 'Payments not configured' }, { status: 503 })

  const event = await getEventBySlug(registration.event_slug)
  const stripePriceId = (event as { stripePriceId?: string } | null)?.stripePriceId
  if (!stripePriceId) return NextResponse.json({ error: 'No price configured for this event' }, { status: 400 })

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: stripePriceId, quantity: 1 }],
    customer_email: member.email,
    metadata: {
      registrationId,
      eventSlug: registration.event_slug,
      participantEmail: member.email,
      isIndividualGroupPayment: 'true',
    },
    success_url: `${SITE_URL}/register/${registration.event_slug}/confirmation?id=${registrationId}&type=group&payment=success`,
    cancel_url: `${SITE_URL}/account?tab=teams`,
  })

  return NextResponse.json({ url: session.url })
}
