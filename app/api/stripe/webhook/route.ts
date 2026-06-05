import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { sendEmail, individualConfirmationEmail, groupPaymentConfirmedEmail } from '@/lib/email'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY not set')
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

// ── Event registration helpers ────────────────────────────────────────────────

async function confirmRegistration(registrationId: string, isGroup: boolean) {
  const db = supabaseServer()

  await db.from('registrations').update({ status: 'confirmed' }).eq('id', registrationId)

  if (isGroup) {
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

// ── Membership helpers ────────────────────────────────────────────────────────

async function activateMembership(
  memberId: string,
  tierId: string,
  billingInterval: string,
  stripeSubscriptionId: string,
) {
  const db = supabaseServer()

  // Deactivate any existing active membership for this member
  await db
    .from('member_memberships')
    .update({ renewal_status: 'expired' })
    .eq('member_id', memberId)
    .eq('renewal_status', 'active')

  const startedAt = new Date().toISOString().split('T')[0]
  const expiresAt = billingInterval === 'monthly'
    ? new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    : new Date(Date.now() + 366 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  await db.from('member_memberships').insert({
    member_id: memberId,
    tier_id: tierId,
    started_at: startedAt,
    expires_at: expiresAt,
    renewal_status: 'active',
    is_complimentary: false,
    stripe_subscription_id: stripeSubscriptionId,
    billing_interval: billingInterval,
  })
}

async function expireMembership(stripeSubscriptionId: string) {
  const db = supabaseServer()

  await db
    .from('member_memberships')
    .update({ renewal_status: 'expired', expires_at: new Date().toISOString().split('T')[0] })
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .eq('renewal_status', 'active')
}

// ── Webhook handler ───────────────────────────────────────────────────────────

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
    // ── checkout.session.completed ──────────────────────────────────────────
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session

      if (session.metadata?.type === 'membership') {
        // Membership purchase
        const { memberId, tierId, billingInterval } = session.metadata
        const subscriptionId = session.subscription as string

        if (memberId && tierId && subscriptionId) {
          await activateMembership(memberId, tierId, billingInterval ?? 'annual', subscriptionId)
        }
      } else {
        // Event registration purchase
        const registrationId = session.metadata?.registrationId ?? session.client_reference_id
        const isGroup = session.metadata?.isGroup === 'true'
        if (registrationId) {
          await confirmRegistration(registrationId, isGroup)
        }
      }
    }

    // ── invoice.paid (recurring renewal) ───────────────────────────────────
    if (event.type === 'invoice.paid') {
      const invoice = event.data.object as Stripe.Invoice & { subscription?: string | null }

      if (invoice.metadata?.type === 'membership' || invoice.subscription) {
        // Membership renewal — extend expires_at by the billing period
        const subscriptionId = invoice.subscription ?? null
        if (subscriptionId) {
          const db = supabaseServer()
          const { data: membership } = await db
            .from('member_memberships')
            .select('id, billing_interval')
            .eq('stripe_subscription_id', subscriptionId)
            .eq('renewal_status', 'active')
            .maybeSingle()

          if (membership) {
            const interval = (membership as { billing_interval: string }).billing_interval
            const newExpiry = interval === 'monthly'
              ? new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
              : new Date(Date.now() + 366 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

            await db
              .from('member_memberships')
              .update({ expires_at: newExpiry })
              .eq('id', (membership as { id: string }).id)
          }
        }
      } else {
        // Event registration invoice
        const registrationId = invoice.metadata?.registrationId
        const isGroup = invoice.metadata?.isGroup === 'true'
        if (registrationId) {
          await confirmRegistration(registrationId, isGroup)
        }
      }
    }

    // ── customer.subscription.deleted (cancellation) ────────────────────────
    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as Stripe.Subscription
      await expireMembership(subscription.id)
    }
  } catch (err) {
    console.error('[stripe/webhook] Handler error:', err)
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
