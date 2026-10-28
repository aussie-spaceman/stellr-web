import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { ensureStripeCustomer } from '@/lib/stripe-customer'
import { assertNotImpersonating } from '@/lib/impersonation'
import { assertLiveCredentials } from '@/lib/env-guards'
import { requireStripe } from '@/lib/stripe'
import { GUARANTEE_RECEIPT_LINE } from '@/lib/guarantee'

// Pay-by-invoice is offered only on the educator / school-district tiers, where
// purchase orders are normal. Student tiers are card-only.
const INVOICE_TIER_NAMES = new Set(['Catalyst', 'Innovator', 'Trailblazer'])

// Issues a Stripe invoice (collection_method: send_invoice) for a membership tier
// and emails it to the member. The tier is NOT granted here — the webhook grants a
// one-time 12-month membership when invoice.paid fires. Mirrors the event-group
// invoice pattern in app/api/register/group/route.ts.
export async function POST(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — see lib/impersonation.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const body = (await req.json()) as { tierId?: string; tierName?: string }
  const { tierId, tierName } = body
  if (!tierId && !tierName) {
    return NextResponse.json({ error: 'Missing tierId or tierName' }, { status: 400 })
  }

  const db = supabaseServer()

  const tierBase = db.from('membership_tiers').select('id, name, annual_cost_cents, is_free, stripe_price_id')
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

  const stripe = requireStripe()

  try {
    // Resolve a valid Stripe customer (self-heals a stale/missing stored id).
    const customerId = await ensureStripeCustomer(stripe, db, member, userId)

    // Stripe Tax needs a billing address. Educators (the only tiers invoiceable)
    // already have one on file via their current school — reuse it; no extra form.
    const { data: link } = await db
      .from('member_schools')
      .select('schools(name, street, address_line1, address_line2, city, state, zip_code, postcode)')
      .eq('member_id', member.id)
      .eq('is_current', true)
      .maybeSingle()
    const school = (Array.isArray(link?.schools) ? link?.schools[0] : link?.schools) as
      | { street?: string | null; address_line1?: string | null; address_line2?: string | null; city?: string | null; state?: string | null; zip_code?: string | null; postcode?: string | null }
      | null
    const line1 = school?.address_line1 || school?.street || null
    const postalCode = school?.postcode || school?.zip_code || null
    const hasTaxAddress = !!(line1 && school?.city && school?.state && postalCode)

    if (hasTaxAddress) {
      await stripe.customers.update(customerId, {
        address: {
          line1: line1 as string,
          line2: school?.address_line2 || undefined,
          city: school?.city as string,
          state: school?.state as string,
          postal_code: postalCode as string,
          country: 'US',
        },
      })
    }

    // deep review PAY-15: refuse to bill on a production deployment holding TEST
    // keys — a test-mode invoice settles nothing. No-op on real prod (live keys).
    assertLiveCredentials('stripe')

    // deep review PAY-14: repeat "Request an invoice" clicks used to email a fresh
    // invoice each time; a member who then paid two of them would be charged twice
    // (the second grants nothing — see PAY-11). Reuse an already-open invoice for
    // this member + tier. Stripe invoice search is eventually consistent, so this
    // won't catch a true double-click a second apart, and a search outage must not
    // block the first invoice — so on ANY search failure we fall through to create.
    try {
      const existing = await stripe.invoices.search({
        query: `status:'open' AND metadata['memberId']:'${member.id}' AND metadata['tierId']:'${tier.id}'`,
        limit: 1,
      })
      const open = existing.data[0]
      if (open) {
        return NextResponse.json({
          ok: true,
          email: member.email,
          hostedInvoiceUrl: open.hosted_invoice_url ?? null,
          deduped: true,
        })
      }
    } catch (e) {
      console.error('[membership-invoice] open-invoice dedup search skipped:', e)
    }

    // deep review PAY-14: bill the LIVE Stripe price the member saw on the site,
    // not membership_tiers.annual_cost_cents — which lib/tier-pricing documents as
    // a FALLBACK only (public pages and card checkout use the Stripe price), so
    // after a Stripe price edit an invoice buyer would be billed a stale amount.
    // Fall back to the DB cost (and USD) only when no usable Stripe price exists.
    let amountCents = tier.annual_cost_cents as number
    let currency = 'usd'
    if (tier.stripe_price_id) {
      try {
        const price = await stripe.prices.retrieve(tier.stripe_price_id as string)
        if (typeof price.unit_amount === 'number' && price.unit_amount > 0) {
          amountCents = price.unit_amount
          currency = price.currency || 'usd'
        }
      } catch (e) {
        console.error('[membership-invoice] live price lookup failed, using DB cost:', e)
      }
    }

    // Create the invoice first, then attach the line item to it explicitly.
    // (Don't rely on pending-item sweeping — that left the total at $0.)
    // Tax is computed only when we have an address, so invoicing never breaks.
    const invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: 'send_invoice',
      days_until_due: 14,
      auto_advance: false,
      automatic_tax: { enabled: hasTaxAddress },
      // The money-back guarantee, printed on the invoice.
      footer: GUARANTEE_RECEIPT_LINE,
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
      currency,
      amount: amountCents,
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
