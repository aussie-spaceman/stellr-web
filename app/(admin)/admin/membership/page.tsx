import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { MembershipNav, type MembershipTab } from './MembershipNav'
import { TiersClient, type TierRow } from '@/components/admin/membership/TiersClient'
import { RulesClient, type RuleRow, type TierOption } from '@/components/admin/membership/RulesClient'
import { DiscountsClient } from '@/components/admin/membership/DiscountsClient'
import { listDiscounts, listTiers, listTierBenefits } from '@/lib/entitlements'

export const metadata = { title: 'Admin — Membership' }
export const dynamic = 'force-dynamic'

const SUBTITLES: Record<MembershipTab, React.ReactNode> = {
  tiers: 'Tiers, grant rules, discounts and access — one place. Prices are read live from Stripe.',
  rules: 'Rules that automatically assign or upgrade a tier when something happens.',
  discounts: (
    <>Discounts &amp; coupons drive every à-la-carte price across the site. Changes here take effect immediately.</>
  ),
}

// Membership Studio · Tiers tab. The catalog of membership tiers with their live
// Stripe price (read, never stored) and active-member counts. Metadata is
// editable inline; price/name stay authoritative in Stripe + the tier row.
async function tiersContent() {
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

  return <TiersClient tiers={rows} stripeConnected={!!stripe} />
}

// Membership Studio · Grant rules tab. CRUD over tier_grant_rules: "when
// <trigger> [matching <conditions>] grant <tier> for <duration>". The evaluator
// in lib/membership-grants.ts reads these whenever a trigger fires.
async function rulesContent() {
  const db = supabaseServer()
  const [{ data: rules }, { data: tiers }] = await Promise.all([
    db.from('tier_grant_rules').select('*').order('trigger_type').order('priority', { ascending: false }),
    db.from('membership_tiers').select('id, name, is_free').order('sort_order'),
  ])

  return <RulesClient initialRules={(rules ?? []) as RuleRow[]} tiers={(tiers ?? []) as TierOption[]} />
}

// Membership Studio · Discounts tab. The single source of truth for per-tier
// discounts and coupon codes that the pricing engine (fn_quote) applies
// everywhere à-la-carte coaching/mentoring is priced, plus the free-allocation
// quantities granted per tier.
async function discountsContent() {
  const [discounts, tiers, allocations] = await Promise.all([
    listDiscounts(),
    listTiers(),
    listTierBenefits(),
  ])

  return <DiscountsClient discounts={discounts} tiers={tiers} allocations={allocations} />
}

// Membership Studio. Three views — Tiers · Grant rules · Discounts —
// dispatch on ?tab= so the studio is one URL (tiers is the default).
export default async function MembershipStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const sp = await searchParams
  const tab = (['tiers', 'rules', 'discounts'].includes(sp.tab ?? '')
    ? sp.tab
    : 'tiers') as MembershipTab

  let content: React.ReactNode = null
  if (tab === 'tiers') content = await tiersContent()
  else if (tab === 'rules') content = await rulesContent()
  else if (tab === 'discounts') content = await discountsContent()

  return (
    <div>
      <h1 className="font-heading uppercase text-title text-brand-blue-dark">Membership Studio</h1>
      <p className="mt-0.5 mb-4 text-sm text-brand-muted-soft">{SUBTITLES[tab]}</p>
      <MembershipNav active={tab} />
      {content}
    </div>
  )
}
