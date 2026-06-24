import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getCurrentMember } from '@/lib/community'
import { supabaseServer } from '@/lib/supabase'
import {
  enrollWithWorkshopCredit,
  enrollWorkshopFree,
  getWorkshopFull,
  resolveWorkshopAccess,
} from '@/lib/workshops'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

// Self-register for an open coaching workshop: free-with-membership, with a
// workshop credit, or via a one-off Stripe payment. Mirrors the mentoring
// cohort register route.
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const workshopId = String(body?.workshopId || '')
  const method = String(body?.method || '') as 'free' | 'credit' | 'paid'
  if (!workshopId) return NextResponse.json({ error: 'Missing workshop' }, { status: 400 })

  const workshop = await getWorkshopFull(workshopId)
  if (!workshop || !workshop.isOpen) {
    return NextResponse.json({ error: 'This workshop is not open for registration' }, { status: 404 })
  }

  const AGREEMENT_MSG = 'A signed participation agreement is required before joining.'

  if (method === 'free') {
    const r = await enrollWorkshopFree(member, workshopId)
    if (!r.ok) {
      const msg = r.reason === 'needs-agreement' ? AGREEMENT_MSG : 'Could not join this workshop'
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  }

  if (method === 'credit') {
    const r = await enrollWithWorkshopCredit(member, workshopId)
    if (!r.ok) {
      const msg =
        r.reason === 'no-credit' ? 'You have no workshop credits left'
        : r.reason === 'needs-agreement' ? AGREEMENT_MSG
        : 'Could not join this workshop'
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  }

  // Paid one-off → Stripe Checkout.
  const access = await resolveWorkshopAccess(member, workshop)
  if (access.enrolled) return NextResponse.json({ error: 'Already enrolled' }, { status: 400 })
  if (!workshop.oneOffPriceCents && !workshop.oneOffStripePriceId) {
    return NextResponse.json({ error: 'This workshop has no one-off payment option' }, { status: 400 })
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
  const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = workshop.oneOffStripePriceId
    ? { price: workshop.oneOffStripePriceId, quantity: 1 }
    : {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: workshop.oneOffPriceCents!,
          product_data: { name: `Coaching workshop — ${workshop.name}` },
        },
      }

  const checkout = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [lineItem],
    ...(buyer?.stripe_customer_id ? { customer: buyer.stripe_customer_id } : buyer?.email ? { customer_email: buyer.email } : {}),
    success_url: `${baseUrl}/community/workshops/${workshopId}?joined=1`,
    cancel_url: `${baseUrl}/community/workshops/discover`,
    metadata: { type: 'workshop_enrollment', memberId: member.id, workshopId },
    payment_intent_data: { metadata: { type: 'workshop_enrollment', memberId: member.id, workshopId } },
  })

  return NextResponse.json({ url: checkout.url })
}
