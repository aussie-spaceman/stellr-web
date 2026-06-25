import { listCoachingTiers, listWorkshopAccessRows } from '@/lib/coaching'
import { AdminCoachingNav } from '@/components/admin/coaching/AdminCoachingNav'
import { CoachingMembershipAccess } from '@/components/admin/coaching/CoachingMembershipAccess'

export const metadata = { title: 'Admin · Coaching membership & access' }

export default async function CoachingAccessPage() {
  const [tiers, workshops] = await Promise.all([listCoachingTiers(), listWorkshopAccessRows()])

  return (
    <div className="flex gap-8">
      <AdminCoachingNav />
      <div className="min-w-0 flex-1 space-y-4">
        <h1 className="font-display text-[28px] font-bold tracking-[-0.02em] text-ink">Membership &amp; access</h1>
        <CoachingMembershipAccess
          tiers={tiers.map((t) => ({ id: t.id, name: t.name, monthlyPriceCents: t.monthlyPriceCents, freeSessions: t.freeSessions }))}
          workshops={workshops.map((w) => ({ id: w.id, name: w.name, freeForTierIds: w.freeForTierIds, oneOffPriceCents: w.oneOffPriceCents }))}
        />
      </div>
    </div>
  )
}
