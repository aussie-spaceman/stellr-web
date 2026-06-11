import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { MembershipNav } from './MembershipNav'
import { TiersClient, type TierRow } from '@/components/admin/membership/TiersClient'

export const metadata = { title: 'Admin — Membership' }
export const dynamic = 'force-dynamic'

// Membership Studio · Tiers tab. The catalog of membership tiers with their live
// Stripe price (read, never stored) and active-member counts. Metadata is
// editable inline; price/name stay authoritative in Stripe + the tier row.
export default async function MembershipTiersPage() {
  const db = supabaseServer()
  const stripeKey = process.env.STRIPE_SECRET_KEY
  const stripe = stripeKey ? new Stripe(stripeKey, { apiVersion: '2026-05-27.dahlia' }) : null

  const [{ data: tiers }, { data: memberships }] = await Promise.all([
    db.from('membership_tiers')
      .select('id, name, is_free, age_bracket, sort_order, stripe_price_id, stripe_price_id_monthly, description, badge_color, default_grant_months, eligible_roles')
      .order('sort_order'),
    db.from('member_memberships').select('tier_id').eq('renewal_status', 'active'),
  ])

  const counts = new Map<string, number>()
  for (const m of memberships ?? []) {
    if (m.tier_id) counts.set(m.tier_id, (counts.get(m.tier_id) ?? 0) + 1)
  }

  async function price(id: string | null): Promise<number | null> {
    if (!stripe || !id) return null
    try {
      const p = await stripe.prices.retrieve(id)
      return typeof p.unit_amount === 'number' ? p.unit_amount / 100 : null
    } catch {
      return null
    }
  }

  const rows: TierRow[] = await Promise.all(
    (tiers ?? []).map(async (t) => ({
      id: t.id,
      name: t.name,
      is_free: t.is_free,
      age_bracket: t.age_bracket,
      description: t.description ?? '',
      badge_color: t.badge_color ?? (t.is_free ? 'green' : 'blue'),
      default_grant_months: t.default_grant_months ?? null,
      eligible_roles: t.eligible_roles ?? [],
      member_count: counts.get(t.id) ?? 0,
      price_annual: t.is_free ? 0 : await price(t.stripe_price_id),
      price_monthly: t.is_free ? 0 : await price(t.stripe_price_id_monthly),
      has_stripe_price: !!t.stripe_price_id,
    })),
  )

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Membership Studio</h1>
      <p className="mt-0.5 mb-4 text-sm text-gray-500">
        Tiers, grant rules, access and members — one place. Prices are read live from Stripe.
      </p>
      <MembershipNav />
      <TiersClient tiers={rows} stripeConnected={!!stripe} />
    </div>
  )
}
