import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { listCohortSessions, listCohortTraining, getCohortChannel } from '@/lib/sessions'
import { listModules } from '@/lib/training'
import { supabaseServer } from '@/lib/supabase'
import { getCohortFull, listCohortRoster, listMentoringTiers } from '@/lib/mentoring'
import { AdminMentoringNav } from '@/components/admin/mentoring/AdminMentoringNav'
import { AdminManageCohort } from '@/components/admin/mentoring/AdminManageCohort'

export const metadata = { title: 'Admin · Manage cohort' }

export default async function AdminManageCohortPage({ params }: { params: Promise<{ id: string }> }) {
  const member = await getCurrentMember()
  if (!member) notFound()
  const { id } = await params
  const cohort = await getCohortFull(id)
  if (!cohort) notFound()

  const [roster, sessions, training, channelId, modules, tiers] = await Promise.all([
    listCohortRoster(id),
    listCohortSessions(id),
    listCohortTraining(member, id),
    getCohortChannel(id),
    listModules(member),
    listMentoringTiers(),
  ])

  const db = supabaseServer()
  const { count: flaggedCount } = await db
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('channel_id', channelId)
    .not('flagged_at', 'is', null)
    .is('deleted_at', null)

  return (
    <div className="flex gap-8">
      <AdminMentoringNav />
      <div className="min-w-0 flex-1 space-y-4">
        <Link href="/admin/community/cohorts" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-content-muted hover:text-primary">
          <ArrowLeft className="h-4 w-4" /> Cohorts
        </Link>
        <AdminManageCohort
          cohort={{
            id: cohort.id,
            name: cohort.name,
            theme: cohort.theme,
            timezone: cohort.timezone,
            plannedSessions: cohort.plannedSessions,
            mentorMemberId: cohort.mentorMemberId,
            mentorName: cohort.mentorName,
            freeForTierIds: cohort.freeForTierIds,
            oneOffPriceCents: cohort.oneOffPriceCents,
          }}
          roster={roster}
          sessions={sessions.map((s) => ({ id: s.id, title: s.title, start: s.scheduled_start, end: s.scheduled_end, status: s.status, recordingStatus: s.recording_status }))}
          resources={training.map((t) => ({ moduleId: t.moduleId, title: t.title, isMandatory: t.isMandatory, dueAt: t.dueAt }))}
          modules={modules.map((m) => ({ id: m.id, title: m.title }))}
          tiers={tiers.map((t) => ({ id: t.id, name: t.name }))}
          channelId={channelId}
          selfMemberId={member.id}
          selfName={[member.first_name, member.last_name].filter(Boolean).join(' ') || undefined}
          flaggedCount={flaggedCount ?? 0}
        />
      </div>
    </div>
  )
}
