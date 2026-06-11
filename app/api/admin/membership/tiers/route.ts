import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'

// Admin tier catalog for the Membership Studio.
//   GET   — every tier with its live Stripe price (annual + monthly) and the
//           count of members currently active on it. Price is read from Stripe,
//           never stored, so Stripe stays the single source of truth.
//   PATCH — edit a tier's descriptive metadata (name/price live in Stripe & DB
//           id; this only touches description, marketing copy, badge, defaults).

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

async function priceAmount(stripe: Stripe | null, id: string | null): Promise<number | null> {
  if (!stripe || !id) return null
  try {
    const p = await stripe.prices.retrieve(id)
    return typeof p.unit_amount === 'number' ? p.unit_amount / 100 : null
  } catch {
    return null
  }
}

export async function GET() {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = supabaseServer()
  const stripe = stripeClient()

  const [{ data: tiers }, { data: memberships }] = await Promise.all([
    db.from('membership_tiers')
      .select('id, name, is_free, age_bracket, sort_order, stripe_price_id, stripe_price_id_monthly, description, marketing_copy, badge_color, default_grant_months, eligible_roles')
      .order('sort_order'),
    db.from('member_memberships').select('tier_id').eq('renewal_status', 'active'),
  ])

  // Active-member counts per tier.
  const counts = new Map<string, number>()
  for (const m of memberships ?? []) {
    if (m.tier_id) counts.set(m.tier_id, (counts.get(m.tier_id) ?? 0) + 1)
  }

  const enriched = await Promise.all(
    (tiers ?? []).map(async (t) => ({
      ...t,
      member_count: counts.get(t.id) ?? 0,
      price_annual: t.is_free ? 0 : await priceAmount(stripe, t.stripe_price_id),
      price_monthly: t.is_free ? 0 : await priceAmount(stripe, t.stripe_price_id_monthly),
    })),
  )

  return NextResponse.json({ tiers: enriched, stripe_connected: !!stripe })
}

export async function PATCH(req: Request) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { id, description, marketing_copy, badge_color, default_grant_months, eligible_roles } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Only the editable metadata fields — price, name, free/paid stay authoritative.
  const patch: Record<string, unknown> = {}
  if (description !== undefined) patch.description = description
  if (marketing_copy !== undefined) patch.marketing_copy = marketing_copy
  if (badge_color !== undefined) patch.badge_color = badge_color
  if (default_grant_months !== undefined) patch.default_grant_months = default_grant_months
  if (eligible_roles !== undefined) patch.eligible_roles = eligible_roles

  const db = supabaseServer()
  const { error } = await db.from('membership_tiers').update(patch).eq('id', id)
  if (error) {
    console.error('[membership/tiers] patch error:', error)
    return NextResponse.json({ error: 'Could not update tier' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
