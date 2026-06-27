import { listMentoringTiers, listCohortAccessRows } from '@/lib/mentoring'
import { AdminMentoringNav } from '@/components/admin/mentoring/AdminMentoringNav'
import { MembershipAccess } from '@/components/admin/mentoring/MembershipAccess'

export const metadata = { title: 'Admin · Membership & access' }

export default async function MembershipAccessPage() {
  const [tiers, cohorts] = await Promise.all([listMentoringTiers(), listCohortAccessRows()])

  return (
    <div className="flex gap-8">
      <AdminMentoringNav />
      <div className="min-w-0 flex-1 space-y-2">
        <h1 className="font-display text-[28px] font-bold tracking-[-0.02em] text-ink">Membership &amp; access</h1>
        <p className="max-w-[620px] text-[14.5px] text-content-secondary">
          Set which membership tiers include free mentoring and how many mentoring credits they grant each year, and
          review per-cohort access. Prices are in USD, read live from Stripe — edit them in Stripe.
        </p>
        <MembershipAccess
          tiers={tiers.map((t) => ({
            id: t.id,
            name: t.name,
            monthlyPriceCents: t.monthlyPriceCents,
            includesFreeMentoring: t.includesFreeMentoring,
            creditsGrant: t.creditsGrant,
            workshopCreditsGrant: t.workshopCreditsGrant,
          }))}
          cohorts={cohorts}
        />
      </div>
    </div>
  )
}
