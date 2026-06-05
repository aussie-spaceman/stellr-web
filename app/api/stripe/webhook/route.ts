import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { sendEmail, individualConfirmationEmail } from '@/lib/email'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY not set')
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const sig = req.headers.get('stripe-signature')
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!sig || !webhookSecret) {
    return NextResponse.json({ error: 'Missing webhook signature or secret' }, { status: 400 })
  }

  const stripe = getStripe()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
  } catch (err) {
    console.error('[stripe/webhook] Signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const registrationId = session.metadata?.registrationId ?? session.client_reference_id

    if (!registrationId) {
      console.error('[stripe/webhook] No registrationId in session metadata')
      return NextResponse.json({ ok: true })
    }

    const db = supabaseServer()

    // Confirm the registration
    const { error: updateErr } = await db
      .from('registrations')
      .update({ status: 'confirmed' })
      .eq('id', registrationId)

    if (updateErr) {
      console.error('[stripe/webhook] Failed to confirm registration:', updateErr)
      return NextResponse.json({ error: 'DB update failed' }, { status: 500 })
    }

    // Fetch participant to send confirmation email
    const { data: participant } = await db
      .from('participants')
      .select('first_name, last_name, email, membership_id, registration_id')
      .eq('registration_id', registrationId)
      .maybeSingle()

    const { data: registration } = await db
      .from('registrations')
      .select('event_title')
      .eq('id', registrationId)
      .maybeSingle()

    if (participant && registration) {
      try {
        const emailContent = individualConfirmationEmail({
          firstName: (participant as { first_name: string }).first_name,
          lastName: (participant as { last_name: string }).last_name,
          membershipId: (participant as { membership_id: string }).membership_id,
          eventTitle: (registration as { event_title: string }).event_title,
          registrationId,
        })
        await sendEmail({ to: (participant as { email: string }).email, ...emailContent })
      } catch (emailErr) {
        console.error('[stripe/webhook] Confirmation email failed (non-fatal):', emailErr)
      }
    }
  }

  return NextResponse.json({ ok: true })
}
