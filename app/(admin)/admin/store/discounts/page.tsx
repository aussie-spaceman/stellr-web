import { supabaseServer } from '@/lib/supabase'
import { listEventDiscounts, listTierDiscounts } from '@/lib/store/discounts'
import { DiscountMatrix } from '@/components/admin/store/DiscountMatrix'
import { StoreNav } from '../StoreNav'

export const metadata = { title: 'Admin — Store discounts' }
export const dynamic = 'force-dynamic'

// Store · Discounts. Two non-stacking axes: membership-tier discounts (applied
// in the storefront) and event merch discounts (global default + per-event
// override — mirrors the refund-policy model). 100% = the free included shirt.
export default async function StoreDiscountsPage() {
  const db = supabaseServer()
  const [tier, event, tiersRes, productsRes] = await Promise.all([
    listTierDiscounts(),
    listEventDiscounts(),
    db.from('membership_tiers').select('id, name').order('sort_order'),
    db.from('store_products').select('id, name').neq('status', 'archived').order('name'),
  ])

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Store</h1>
      <p className="mt-0.5 mb-4 text-sm text-gray-500">Discounts applied to merchandise.</p>
      <StoreNav />
      <DiscountMatrix
        tier={tier}
        event={event}
        tiers={(tiersRes.data ?? []) as { id: string; name: string }[]}
        products={(productsRes.data ?? []) as { id: string; name: string }[]}
      />
    </div>
  )
}
