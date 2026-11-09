import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { communityWriteBlock } from '@/lib/community'
import { getOnboardedMember } from '@/lib/onboarded-member'
import { supabaseServer } from '@/lib/supabase'
import { CREDIT_PACK_PRICE_CENTS } from '@/lib/mentoring-format'
import { getAcademyDiscountPercent, discountCents } from '@/lib/academy-discount'
import { ensureStripeCustomer } from '@/lib/stripe-customer'
import { assertNotImpersonating } from '@/lib/impersonation'
import { assertLiveCredentials } from '@/lib/env-guards'
import { stripeClient } from '@/lib/stripe'
import { GUARANTEE_CHECKOUT_TEXT } from '@/lib/guarantee'
import { auditMutation } from '@/lib/audit/route'
import { noteAudit, selfServiceEvent, type SelfServiceAudit } from '@/lib/community/self-service-audit'

// Buy extra mentoring SESSION credits (top-up beyond the tier allowance). Mentoring
// is accounted per session — a cohort enrollment draws its planned 4/6/8 sessions
// from the ledger (migration 106) — so `quantity` is a number of sessions. The
// Stripe webhook (type 'mentoring_topup') grants a purchased cohort_access lot of
// `quantity` on success (grantPurchasedLot), which enrollment then draws FIFO
// alongside the tier allowance (migration 122). Mirrors /api/community/coaching/topup.
export async function POST(req: Request) {
  return audited(req, { action: 'community.mentoring.topup' }, () => startMentoringTopup(req))
}

async function startMentoringTopup(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getOnboardedMember()
  if (!member) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  // Decision 24: age and guardian-consent restrictions (lib/community).
  const restricted = await communityWriteBlock(member, 'purchase')
  if (restricted) return restricted

  const body = await req.json().catch(() => ({}))
  const quantity = Math.max(1, Math.min(20, Math.floor(Number(body?.quantity) || 1)))

  const stripe = stripeClient()
  if (!stripe) return NextResponse.json({ error: 'Payments not configured' }, { status: 503 })

  const unit0 = Number(process.env.MENTORING_CREDIT_PRICE_CENTS) || CREDIT_PACK_PRICE_CENTS
  const unit = discountCents(unit0, await getAcademyDiscountPercent(member.activeTierIds))

  const db = supabaseServer()
  const { data: m } = await db.from('members').select('email, stripe_customer_id').eq('id', member.id).maybeSingle()
  const buyer = m as { email: string | null; stripe_customer_id: string | null } | null
  const customerId = await ensureStripeCustomer(
    stripe, db,
    { id: member.id, email: buyer?.email ?? null, stripe_customer_id: buyer?.stripe_customer_id ?? null },
  )

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
  // deep review PAY-15: refuse to take money on a production deployment holding
  // TEST keys — a test-mode charge looks successful and settles nothing. No-op on
  // real prod (live keys); the price derivation above is deliberately not gated.
  assertLiveCredentials('stripe')
  const checkout = await stripe.checkout.sessions.create({
    // The money-back guarantee, on Stripe's page above the Pay button.
    custom_text: GUARANTEE_CHECKOUT_TEXT,
    mode: 'payment',
    line_items: [
      {
        quantity,
        price_data: {
          currency: 'usd',
          unit_amount: unit,
          product_data: { name: 'Mentoring session' },
        },
      },
    ],
    customer: customerId,
    success_url: `${baseUrl}/community/mentoring/discover?topup=1`,
    cancel_url: `${baseUrl}/community/mentoring/discover`,
    metadata: { type: 'mentoring_topup', memberId: member.id, quantity: String(quantity) },
    payment_intent_data: { metadata: { type: 'mentoring_topup', memberId: member.id, quantity: String(quantity) } },
  })

  noteAudit(req, { metadata: { quantity, checkout_session: checkout.id } })
  return NextResponse.json({ url: checkout.url })
}

// The audit event for this route (docs/TENANCY-S5.md, B16): written after the response,
// never for a 4xx, ids and short codes only. lib/community/self-service-audit decides
// what is written; the call stays here because the coverage gate reads it here.
async function audited(req: Request, spec: SelfServiceAudit, run: () => Promise<Response>): Promise<Response> {
  let res: Response | undefined
  try {
    return (res = await run())
  } finally {
    await record(req, res, spec)
  }
}

async function record(req: Request, res: Response | undefined, spec: SelfServiceAudit) {
  const event = await selfServiceEvent(req, res, spec)
  if (!event) return
  await auditMutation(event, { afterResponse: true })
}
