import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { stripeClient } from '@/lib/refunds/stripe'

// GET /api/members/billing/receipt?participation=<participant_id>
// Redirects to the Stripe receipt for a participation the member was paid into:
//   1. participants.stripe_payment_intent_id  — member paid their own seat
//   2. registrations.stripe_payment_intent_id — individual reg or whole-group card
//   3. invoice metadata.registrationId        — organiser paid by invoice; the
//      invoice id was never persisted, so it's recovered via Stripe search.
// Plain-anchor friendly: 302 on success, small HTML message otherwise.

function htmlMessage(message: string, status: number) {
  return new NextResponse(
    `<!doctype html><body style="font-family:sans-serif;padding:2rem;color:#374151">${message}</body>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}

async function receiptFromPaymentIntent(stripe: Stripe, paymentIntentId: string): Promise<string | null> {
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] })
    const charge = pi.latest_charge
    if (charge && typeof charge !== 'string') return charge.receipt_url ?? null
  } catch (err) {
    console.error('[billing/receipt] PaymentIntent lookup failed:', err)
  }
  return null
}

async function receiptFromInvoice(stripe: Stripe, registrationId: string): Promise<string | null> {
  try {
    const found = await stripe.invoices.search({
      query: `metadata['registrationId']:'${registrationId}'`,
      limit: 10,
    })
    const paid = found.data.find(inv => inv.status === 'paid') ?? found.data[0]
    return paid?.invoice_pdf ?? paid?.hosted_invoice_url ?? null
  } catch (err) {
    console.error('[billing/receipt] Invoice search failed:', err)
  }
  return null
}

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return htmlMessage('Please sign in to view receipts.', 401)

  const participationId = req.nextUrl.searchParams.get('participation')
  if (!participationId) return htmlMessage('Missing participation reference.', 400)

  const db = supabaseServer()

  const { data: member } = await db
    .from('members')
    .select('id')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()
  if (!member) return htmlMessage('Member record not found.', 404)

  const { data: participant } = await db
    .from('participants')
    .select('id, member_id, registration_id, stripe_payment_intent_id')
    .eq('id', participationId)
    .eq('member_id', member.id)
    .maybeSingle()
  if (!participant) return htmlMessage('Participation not found.', 404)

  const { data: registration } = await db
    .from('registrations')
    .select('id, status, invoice_requested, stripe_payment_intent_id')
    .eq('id', participant.registration_id)
    .maybeSingle()
  if (!registration) return htmlMessage('Registration not found.', 404)

  const stripe = stripeClient()
  if (!stripe) return htmlMessage('Payments are not configured.', 503)

  let url: string | null = null
  if (participant.stripe_payment_intent_id) {
    url = await receiptFromPaymentIntent(stripe, participant.stripe_payment_intent_id)
  }
  if (!url && registration.stripe_payment_intent_id) {
    url = await receiptFromPaymentIntent(stripe, registration.stripe_payment_intent_id)
  }
  if (!url && registration.invoice_requested) {
    url = await receiptFromInvoice(stripe, registration.id)
  }

  if (!url) {
    return htmlMessage(
      'No receipt is available for this payment yet. If the payment was recent, please check back shortly.',
      404
    )
  }

  return NextResponse.redirect(url, 302)
}
