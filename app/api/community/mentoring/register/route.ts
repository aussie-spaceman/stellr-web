import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getCurrentMember } from '@/lib/community'
import { supabaseServer } from '@/lib/supabase'
import { enrollWithCredit, enrollFree, getCohortFull, resolveCohortAccess } from '@/lib/mentoring'
import { getAcademyDiscountPercent, academyLineItemFromPrice, discountCents } from '@/lib/academy-discount'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

// Self-register for an open mentoring cohort: free-with-membership, with a
// mentoring credit, or via a one-off Stripe payment.
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const cohortId = String(body?.cohortId || '')
  const method = String(body?.method || '') as 'free' | 'credit' | 'paid'
  if (!cohortId) return NextResponse.json({ error: 'Missing cohort' }, { status: 400 })

  const cohort = await getCohortFull(cohortId)
  if (!cohort || !cohort.isOpen) return NextResponse.json({ error: 'This cohort is not open for registration' }, { status: 404 })

  if (method === 'free') {
    const r = await enrollFree(member, cohortId)
    if (!r.ok) return NextResponse.json({ error: 'Could not join this cohort' }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  if (method === 'credit') {
    const r = await enrollWithCredit(member, cohortId)
    if (!r.ok) {
      const msg = r.reason === 'no-credit' ? 'You have no mentoring credits left' : 'Could not join this cohort'
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  }

  // Paid one-off → Stripe Checkout.
  const access = await resolveCohortAccess(member, cohort)
  if (access.enrolled) return NextResponse.json({ error: 'Already enrolled' }, { status: 400 })
  if (!cohort.oneOffPriceCents && !cohort.oneOffStripePriceId) {
    return NextResponse.json({ error: 'This cohort has no one-off payment option' }, { status: 400 })
  }

  const stripe = getStripe()
  if (!stripe) return NextResponse.json({ error: 'Payments not configured' }, { status: 503 })

  const db = supabaseServer()
  const { data: m } = await db
    .from('members')
    .select('email, stripe_customer_id')
    .eq('id', member.id)
    .maybeSingle()
  const buyer = m as { email: string | null; stripe_customer_id: string | null } | null

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
  const academyPct = await getAcademyDiscountPercent(member.activeTierIds)
  const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = cohort.oneOffStripePriceId
    ? await academyLineItemFromPrice(stripe, cohort.oneOffStripePriceId, academyPct, `Mentoring cohort — ${cohort.name}`)
    : {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: discountCents(cohort.oneOffPriceCents!, academyPct),
          product_data: { name: `Mentoring cohort — ${cohort.name}` },
        },
      }

  const checkout = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [lineItem],
    ...(buyer?.stripe_customer_id ? { customer: buyer.stripe_customer_id } : buyer?.email ? { customer_email: buyer.email } : {}),
    success_url: `${baseUrl}/community/mentoring/${cohortId}?joined=1`,
    cancel_url: `${baseUrl}/community/mentoring/discover`,
    metadata: { type: 'mentoring_cohort', memberId: member.id, cohortId },
    payment_intent_data: { metadata: { type: 'mentoring_cohort', memberId: member.id, cohortId } },
  })

  return NextResponse.json({ url: checkout.url })
}
