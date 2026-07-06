import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { getMentoringCredits, listOpenCohorts } from '@/lib/mentoring'
import { CREDIT_PACK_PRICE_CENTS } from '@/lib/mentoring-format'
import { DiscoverGrid, type DiscoverCohort } from '@/components/community/mentoring/DiscoverGrid'
import { TopUpCredits } from '@/components/community/mentoring/TopUpCredits'

export const metadata = { title: 'Mentoring · Find a cohort' }

export default async function DiscoverPage() {
  const member = await getCurrentMember()
  // Fallback guest gate (middleware normally handles this first). Preserve the
  // return path so guests resume into discovery after sign-up + onboarding.
  if (!member) redirect(`/sign-up?next=${encodeURIComponent('/community/mentoring/discover')}`)

  const [credits, open] = await Promise.all([getMentoringCredits(member), listOpenCohorts(member)])
  const creditPriceCents = Number(process.env.MENTORING_CREDIT_PRICE_CENTS) || CREDIT_PACK_PRICE_CENTS

  const cohorts: DiscoverCohort[] = open.map((c) => ({
    id: c.id,
    name: c.name,
    theme: c.theme,
    blurb: c.blurb,
    mentorName: c.mentorName,
    startDate: c.startDate,
    plannedSessions: c.plannedSessions,
    access: {
      kind: c.access.kind,
      priceCents: c.access.priceCents,
      creditCost: c.access.creditCost,
      canUseCredit: c.access.canUseCredit,
    },
  }))

  return (
    <div className="mx-auto max-w-content space-y-6">
      <Link href="/community/mentoring" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-content-muted hover:text-primary">
        <ArrowLeft className="h-4 w-4" /> Your cohorts
      </Link>

      <header>
        <p className="font-subheading text-[13px] font-semibold uppercase tracking-[0.13em] text-space-violet">
          Academy · Mentoring
        </p>
        <h1 className="mt-1 font-display text-[34px] font-bold leading-tight tracking-[-0.02em] text-ink">
          Find a cohort to join
        </h1>
        <p className="mt-1.5 max-w-xl text-[15px] text-content-secondary">
          Open cohorts you can register for now — free with your membership, with your session credits, or as a one-off.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-pill bg-space-violet-chip px-3.5 py-1.5 text-[13px] font-semibold text-space-violet-text">
            Your membership · {credits.remaining} session credit{credits.remaining === 1 ? '' : 's'} remaining
          </span>
          <TopUpCredits unitPriceCents={creditPriceCents} />
        </div>
      </header>

      <DiscoverGrid cohorts={cohorts} creditsRemaining={credits.remaining} />
    </div>
  )
}
