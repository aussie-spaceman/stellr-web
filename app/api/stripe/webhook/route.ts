import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { sendEmail, individualConfirmationEmail, groupPaymentConfirmedEmail } from '@/lib/email'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY not set')
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

async function confirmRegistration(registrationId: string, isGroup: boolean) {
  const db = supabaseServer()

  await db.from('registrations').update({ status: 'confirmed' }).eq('id', registrationId)

  if (isGroup) {
    // Send payment confirmed email to teacher
    const { data: reg } = await db.from('registrations')
      .select('event_title, teacher_first_name, teacher_email')
      .eq('id', registrationId).maybeSingle()

    if (reg) {
      const r = reg as { event_title: string; teacher_first_name: string | null; teacher_email: string | null }
      if (r.teacher_email) {
        const emailContent = groupPaymentConfirmedEmail({
          teacherFirstName: r.teacher_first_name ?? 'there',
          eventTitle: r.event_title,
          registrationId,
        })
        await sendEmail({ to: r.teacher_email, ...emailContent })
      }
    }
  } else {
    // Send individual confirmation email with membership ID
    const { data: participant } = await db.from('participants')
      .select('first_name, last_name, email, membership_id')
      .eq('registration_id', registrationId).maybeSingle()

    const { data: reg } = await db.from('registrations')
      .select('event_title').eq('id', registrationId).maybeSingle()

    if (participant && reg) {
      const p = participant as { first_name: string; last_name: string; email: string; membership_id: string }
      const r = reg as { event_title: string }
      const emailContent = individualConfirmationEmail({
        firstName: p.first_name, lastName: p.last_name,
        membershipId: p.membership_id, eventTitle: r.event_title,
        registrationId,
      })
      await sendEmail({ to: p.email, ...emailContent })
    }
  }
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

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      const registrationId = session.metadata?.registrationId ?? session.client_reference_id
      const isGroup = session.metadata?.isGroup === 'true'

      if (registrationId) {
        await confirmRegistration(registrationId, isGroup)
      }
    }

    if (event.type === 'invoice.paid') {
      const invoice = event.data.object as Stripe.Invoice
      const registrationId = invoice.metadata?.registrationId
      const isGroup = invoice.metadata?.isGroup === 'true'

      if (registrationId) {
        await confirmRegistration(registrationId, isGroup)
      }
    }
  } catch (err) {
    console.error('[stripe/webhook] Handler error:', err)
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
