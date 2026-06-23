import { supabaseServer } from '@/lib/supabase'
import { listEventDiscounts, listTierDiscounts } from '@/lib/store/discounts'
import { getAllEvents, getAllCampaigns } from '@/lib/sanity'
import { DiscountMatrix, type EventOption } from '@/components/admin/store/DiscountMatrix'
import { StoreNav } from '../StoreNav'

export const metadata = { title: 'Admin — Store discounts' }
export const dynamic = 'force-dynamic'

// Store · Discounts. Two non-stacking axes: membership-tier discounts (applied
// in the storefront) and event merch discounts (global default + per-event
// override — mirrors the refund-policy model). 100% = the free included shirt.
export default async function StoreDiscountsPage() {
  const db = supabaseServer()
  const [tier, event, tiersRes, productsRes, allEvents, allCampaigns] = await Promise.all([
    listTierDiscounts(),
    listEventDiscounts(),
    db.from('membership_tiers').select('id, name').order('sort_order'),
    db.from('store_products').select('id, name').neq('status', 'archived').order('name'),
    getAllEvents().catch(() => null),
    getAllCampaigns().catch(() => null),
  ])

  type EventDoc = { slug?: { current?: string }; title?: string }
  const events: EventOption[] = [...((allEvents ?? []) as EventDoc[]), ...((allCampaigns ?? []) as EventDoc[])]
    .map((e) => ({ slug: e.slug?.current ?? '', title: e.title || e.slug?.current || '' }))
    .filter((e) => e.slug)

  return (
    <div>
      <h1 className="font-heading uppercase text-title text-brand-blue-dark">Store</h1>
      <p className="mt-0.5 mb-4 text-sm text-brand-muted-soft">Discounts applied to merchandise.</p>
      <StoreNav />
      <DiscountMatrix
        tier={tier}
        event={event}
        tiers={(tiersRes.data ?? []) as { id: string; name: string }[]}
        products={(productsRes.data ?? []) as { id: string; name: string }[]}
        events={events}
      />
    </div>
  )
}
