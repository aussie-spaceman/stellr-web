import { MembershipNav } from '../MembershipNav'
import { DiscountsClient } from '@/components/admin/membership/DiscountsClient'
import { listDiscounts, listTiers, listTierBenefits } from '@/lib/entitlements'

export const metadata = { title: 'Admin — Discounts & coupons' }
export const dynamic = 'force-dynamic'

// Membership Studio · Discounts tab. The single source of truth for per-tier
// discounts and coupon codes that the pricing engine (fn_quote) applies
// everywhere à-la-carte coaching/mentoring is priced, plus the free-allocation
// quantities granted per tier.
export default async function DiscountsPage() {
  const [discounts, tiers, allocations] = await Promise.all([
    listDiscounts(),
    listTiers(),
    listTierBenefits(),
  ])

  return (
    <div>
      <h1 className="font-heading uppercase text-title text-brand-blue-dark">Membership Studio</h1>
      <p className="mt-0.5 mb-4 text-sm text-brand-muted-soft">
        Discounts &amp; coupons drive every à-la-carte price across the site. Changes here take effect immediately.
      </p>
      <MembershipNav />
      <DiscountsClient discounts={discounts} tiers={tiers} allocations={allocations} />
    </div>
  )
}
