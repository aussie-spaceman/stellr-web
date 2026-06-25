import { redirect, notFound } from 'next/navigation'
import { Calendar, Users } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { supabaseServer } from '@/lib/supabase'
import { getWorkshopFull } from '@/lib/coaching'
import { CoachingInviteActions } from '@/components/community/coaching/CoachingInviteActions'

export const metadata = { title: 'Coaching · Workshop invitation' }

export default async function CoachingInvitePage({ params }: { params: Promise<{ workshopId: string }> }) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const { workshopId } = await params
  const db = supabaseServer()
  const { data: row } = await db
    .from('cohort_members')
    .select('status')
    .eq('cohort_id', workshopId)
    .eq('member_id', member.id)
    .maybeSingle()

  if (row?.status === 'active') redirect(`/community/coaching/${workshopId}`)
  if (!row || row.status !== 'invited') notFound()

  const ws = await getWorkshopFull(workshopId)
  if (!ws) notFound()
  const startLabel = ws.startDate
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' }).format(new Date(ws.startDate))
    : 'TBC'

  return (
    <div className="mx-auto max-w-[680px] py-4">
      <div className="overflow-hidden rounded-panel border border-line bg-white shadow-card-lift">
        <div
          className="px-8 py-8 text-white"
          style={{ background: 'radial-gradient(130% 150% at 88% -30%, #36306F, #181D44 48%, #0E1330)' }}
        >
          <p className="font-subheading text-[12px] font-semibold uppercase tracking-[0.13em] text-hero-dim">
            Workshop invitation
          </p>
          <h1 className="mt-2 font-display text-[28px] font-bold tracking-[-0.02em]">{ws.name}</h1>
          <p className="mt-1.5 max-w-md text-[14px] text-hero-lead">
            A private 1-on-1 coaching workshop with a Stellr coach — live sessions, training, recordings, actions and chat.
          </p>
        </div>

        <div className="space-y-5 p-8">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ background: '#16B6C4' }}>
              {(ws.coachName ?? 'C').charAt(0)}
            </span>
            <div>
              <p className="text-sm font-semibold text-ink">{ws.coachName ?? 'Stellr coach'}</p>
              <p className="text-[12.5px] text-content-muted">Your coach</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <StatTile icon={<Calendar className="h-4 w-4" />} label="Starts" value={startLabel} />
            <StatTile icon={<Users className="h-4 w-4" />} label="Sessions" value={`${ws.plannedSessions} live`} />
          </div>

          <div className="rounded-[12px] bg-primary-soft px-4 py-3 text-sm font-medium text-primary">
            This coaching is included with your membership — no payment needed.
          </div>

          <CoachingInviteActions workshopId={workshopId} />
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
