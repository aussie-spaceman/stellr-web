import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getCurrentMember } from '@/lib/community'
import { getWorkshopSpace, getWorkshopFull, getCoachingAllowance } from '@/lib/coaching'
import { AccessPanel } from '@/components/community/coaching/AccessPanel'

export const metadata = { title: 'Coaching · Access & sessions' }

const SESSION_PRICE_CENTS = Number(process.env.COACHING_SESSION_PRICE_CENTS) || 4000

export default async function AccessPage({ params }: { params: Promise<{ workshopId: string }> }) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const { workshopId } = await params
  const [space, full, allowance] = await Promise.all([
    getWorkshopSpace(member.id, workshopId),
    getWorkshopFull(workshopId),
    getCoachingAllowance(member),
  ])
  if (!space || !full) notFound()

  return (
    <div className="mx-auto max-w-content space-y-6">
      <div>
        <Link href={`/community/coaching/${workshopId}`} className="text-[13px] font-medium text-content-muted hover:text-primary">
          ← Back to workshop
        </Link>
        <h1 className="mt-2 font-display text-[28px] font-bold tracking-[-0.02em] text-ink">Access &amp; sessions</h1>
        <p className="mt-1 text-[15px] text-content-secondary">
          Your free coaching allowance, buying extra sessions, and requesting a time with {full.coachName ?? 'your coach'}.
        </p>
      </div>

      <AccessPanel
        workshopId={workshopId}
        coachName={full.coachName}
        included={allowance.included}
        remaining={allowance.remaining}
        extraCredits={allowance.extraCredits}
        tierName={allowance.tierName}
        periodEnd={allowance.periodEnd}
        sessionPriceCents={SESSION_PRICE_CENTS}
        timezone={full.timezone}
      />
    </div>
  )
}
