import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { ensureStripeCustomer } from '@/lib/stripe-customer'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY not set')
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

// Pay-by-invoice is offered only on the educator / school-district tiers, where
// purchase orders are normal. Student tiers are card-only.
const INVOICE_TIER_NAMES = new Set(['Catalyst', 'Innovator', 'Trailblazer'])

// Issues a Stripe invoice (collection_method: send_invoice) for a membership tier
// and emails it to the member. The tier is NOT granted here — the webhook grants a
// one-time 12-month membership when invoice.paid fires. Mirrors the event-group
// invoice pattern in app/api/register/group/route.ts.
export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json()) as { tierId?: string; tierName?: string }
  const { tierId, tierName } = body
  if (!tierId && !tierName) {
    return NextResponse.json({ error: 'Missing tierId or tierName' }, { status: 400 })
  }

  const db = supabaseServer()

  const tierBase = db.from('membership_tiers').select('id, name, annual_cost_cents, is_free')
  const { data: tier } = tierId
    ? await tierBase.eq('id', tierId).single()
    : await tierBase.eq('name', tierName!).single()

  if (!tier || tier.is_free || !tier.annual_cost_cents) {
    return NextResponse.json({ error: 'Invalid tier' }, { status: 400 })
  }
  if (!INVOICE_TIER_NAMES.has(tier.name)) {
    return NextResponse.json({ error: 'Invoicing is not available for this tier' }, { status: 400 })
  }

  const { data: member } = await db
    .from('members')
    .select('id, email, first_name, last_name, stripe_customer_id')
    .eq('clerk_user_id', userId)
    .single()

  if (!member || !member.email) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  const stripe = getStripe()

  try {
    // Resolve a valid Stripe customer (self-heals a stale/missing stored id).
    const customerId = await ensureStripeCustomer(stripe, db, member, userId)

    // Create the invoice first, then attach the line item to it explicitly.
    // (Don't rely on pending-item sweeping — that left the total at $0.)
    const invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: 'send_invoice',
      days_until_due: 14,
      auto_advance: false,
      description: `Stellr ${tier.name} membership (annual)`,
      metadata: {
        type: 'membership_invoice',
        memberId: member.id,
        tierId: tier.id,
        billingInterval: 'annual',
      },
    })

    await stripe.invoiceItems.create({
      customer: customerId,
      invoice: invoice.id,
      currency: 'usd',
      amount: tier.annual_cost_cents,
      description: `Stellr ${tier.name} membership — 12 months`,
    })

    const finalized = await stripe.invoices.finalizeInvoice(invoice.id)
    await stripe.invoices.sendInvoice(finalized.id)

    return NextResponse.json({
      ok: true,
      email: member.email,
      hostedInvoiceUrl: finalized.hosted_invoice_url ?? null,
    })
  } catch (err) {
    console.error('[membership-invoice] failed:', err)
    return NextResponse.json({ error: 'Could not create invoice' }, { status: 500 })
  }
}
