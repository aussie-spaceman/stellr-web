import { supabaseServer } from '@/lib/supabase'
import { listAllWorkshops } from '@/lib/workshops'
import { getPlatformPricing } from '@/lib/pricing'
import { WorkshopsAdmin, type AdminWorkshop, type TierOpt } from '@/components/admin/workshops/WorkshopsAdmin'

export const metadata = { title: 'Admin · Coaching workshops' }
export const dynamic = 'force-dynamic'

export default async function AdminWorkshopsPage() {
  const db = supabaseServer()
  const [workshops, pricing, { data: tierRows }] = await Promise.all([
    listAllWorkshops(),
    getPlatformPricing(),
    db.from('membership_tiers').select('id, name, is_free').eq('is_free', false).order('sort_order'),
  ])

  const tiers: TierOpt[] = ((tierRows ?? []) as { id: string; name: string }[]).map((t) => ({ id: t.id, name: t.name }))

  return (
    <div className="mx-auto max-w-content">
      <WorkshopsAdmin initialWorkshops={workshops as AdminWorkshop[]} tiers={tiers} pricing={pricing} />
    </div>
  )
}
