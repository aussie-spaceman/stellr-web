import { redirect, notFound } from 'next/navigation'
import { Calendar, Users } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { supabaseServer } from '@/lib/supabase'
import { getCohortFull } from '@/lib/mentoring'
import { themeTile } from '@/lib/mentoring-format'
import { InviteActions } from '@/components/community/mentoring/InviteActions'

export const metadata = { title: 'Mentoring · Cohort invitation' }

export default async function InvitePage({ params }: { params: Promise<{ cohortId: string }> }) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const { cohortId } = await params
  const db = supabaseServer()
  const { data: row } = await db
    .from('cohort_members')
    .select('status')
    .eq('cohort_id', cohortId)
    .eq('member_id', member.id)
    .maybeSingle()

  if (row?.status === 'active') redirect(`/community/mentoring/${cohortId}`)
  if (!row || row.status !== 'invited') notFound()

  const cohort = await getCohortFull(cohortId)
  if (!cohort) notFound()
  const tile = themeTile(cohort.theme)
  const startLabel = cohort.startDate
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' }).format(new Date(cohort.startDate))
    : 'TBC'

  return (
    <div className="mx-auto max-w-[680px] py-4">
      <div className="overflow-hidden rounded-panel border border-line bg-white shadow-card-lift">
        {/* Navy header */}
        <div
          className="px-8 py-8 text-white"
          style={{ background: 'radial-gradient(130% 150% at 88% -30%, #36306F, #181D44 48%, #0E1330)' }}
        >
          <p className="font-subheading text-[12px] font-semibold uppercase tracking-[0.13em] text-hero-dim">
            Cohort invitation
          </p>
          <h1 className="mt-2 font-display text-[28px] font-bold tracking-[-0.02em]">{cohort.name}</h1>
          <p className="mt-1.5 max-w-md text-[14px] text-hero-lead">
            {cohort.blurb ?? 'A small-group development cohort led by a Stellr mentor — live sessions, resources, actions and chat.'}
          </p>
        </div>

        {/* Body */}
        <div className="space-y-5 p-8">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ background: '#16B6C4' }}>
              {(cohort.mentorName ?? 'M').charAt(0)}
            </span>
            <div>
              <p className="text-sm font-semibold text-ink">{cohort.mentorName ?? 'Stellr mentor'}</p>
              <p className="text-[12.5px] text-content-muted">Your mentor</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <StatTile icon={<Calendar className="h-4 w-4" />} label="Starts" value={startLabel} />
            <StatTile icon={<Users className="h-4 w-4" />} label="Sessions" value={`${cohort.plannedSessions} live`} />
          </div>

          <div className="rounded-[12px] bg-primary-soft px-4 py-3 text-sm font-medium text-primary">
            This cohort is included with your membership — no payment needed.
          </div>

          <InviteActions cohortId={cohortId} />
        </div>
      </div>
    </div>
  )
}

function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-line bg-surface px-4 py-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-content-faint">
        <span className="text-space-violet">{icon}</span> {label}
      </p>
      <p className="mt-1 font-display text-[18px] font-bold text-ink">{value}</p>
    </div>
  )
}
