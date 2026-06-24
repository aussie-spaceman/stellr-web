import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { getCredits } from '@/lib/credits'
import { listOpenWorkshops } from '@/lib/workshops'
import { getPlatformPricing } from '@/lib/pricing'
import { WorkshopDiscoverGrid, type DiscoverWorkshop } from '@/components/community/workshops/WorkshopDiscoverGrid'
import { TopUpWorkshopCredits } from '@/components/community/workshops/TopUpWorkshopCredits'

export const metadata = { title: 'Workshops · Find a workshop' }

export default async function WorkshopDiscoverPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const [credits, open, pricing] = await Promise.all([
    getCredits(member, 'workshop'),
    listOpenWorkshops(member),
    getPlatformPricing(),
  ])
  const creditPriceCents = Number(process.env.WORKSHOP_CREDIT_PRICE_CENTS) || pricing.workshopCreditPriceCents

  const workshops: DiscoverWorkshop[] = open.map((w) => ({
    id: w.id,
    name: w.name,
    theme: w.theme,
    blurb: w.blurb,
    mentorName: w.mentorName,
    startDate: w.startDate,
    plannedSessions: w.plannedSessions,
    access: {
      kind: w.access.kind,
      priceCents: w.access.priceCents,
      creditCost: w.access.creditCost,
      canUseCredit: w.access.canUseCredit,
    },
  }))

  return (
    <div className="mx-auto max-w-content space-y-6">
      <Link href="/community/workshops" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-content-muted hover:text-primary">
        <ArrowLeft className="h-4 w-4" /> Your workshops
      </Link>

      <header>
        <p className="font-subheading text-[13px] font-semibold uppercase tracking-[0.13em] text-space-violet">
          Academy · Coaching workshops
        </p>
        <h1 className="mt-1 font-display text-[34px] font-bold leading-tight tracking-[-0.02em] text-ink">
          Find a workshop to join
        </h1>
        <p className="mt-1.5 max-w-xl text-[15px] text-content-secondary">
          Open coaching workshops you can register for now — free with your membership, with a workshop credit, or as a one-off.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-pill bg-space-violet-chip px-3.5 py-1.5 text-[13px] font-semibold text-space-violet-text">
            Your membership · {credits.remaining} workshop credit{credits.remaining === 1 ? '' : 's'} remaining
          </span>
          <TopUpWorkshopCredits unitPriceCents={creditPriceCents} />
        </div>
      </header>

      <WorkshopDiscoverGrid workshops={workshops} creditsRemaining={credits.remaining} />
    </div>
  )
}
