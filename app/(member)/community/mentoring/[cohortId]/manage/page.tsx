import { redirect, notFound } from 'next/navigation'
import { getCurrentMember } from '@/lib/community'
import {
  isCohortMentor,
  listCohortSessions,
  listCohortTraining,
  getCohortChannel,
} from '@/lib/sessions'
import { listModules } from '@/lib/training'
import { supabaseServer } from '@/lib/supabase'
import {
  getCohortFull,
  listCohortRoster,
  listCohortActionsForMentor,
  listCohortFileResources,
} from '@/lib/mentoring'
import { ManageCohort } from '@/components/community/mentoring/ManageCohort'

export const metadata = { title: 'Mentoring · Manage cohort' }

export default async function ManageCohortPage({
  params,
}: {
  params: Promise<{ cohortId: string }>
}) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const { cohortId } = await params
  const cohort = await getCohortFull(cohortId)
  if (!cohort) notFound()

  const allowed = member.isAdmin || (await isCohortMentor(cohortId, member.id))
  if (!allowed) redirect(`/community/mentoring/${cohortId}`)

  const [sessions, training, roster, actionGroups, modules, channelId, fileResources] = await Promise.all([
    listCohortSessions(cohortId),
    listCohortTraining(member, cohortId),
    listCohortRoster(cohortId),
    listCohortActionsForMentor(cohortId),
    listModules(member),
    getCohortChannel(cohortId),
    listCohortFileResources(cohortId),
  ])

  const db = supabaseServer()
  const { count: flaggedCount } = await db
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('channel_id', channelId)
    .not('flagged_at', 'is', null)
    .is('deleted_at', null)

  return (
    <ManageCohort
      cohort={{
        id: cohort.id,
        name: cohort.name,
        theme: cohort.theme,
        timezone: cohort.timezone,
        plannedSessions: cohort.plannedSessions,
      }}
      roster={roster}
      sessions={sessions.map((s) => ({
        id: s.id,
        title: s.title,
        start: s.scheduled_start,
        end: s.scheduled_end,
        status: s.status,
        recordingStatus: s.recording_status,
      }))}
      resources={training.map((t) => ({ moduleId: t.moduleId, title: t.title, isMandatory: t.isMandatory, dueAt: t.dueAt }))}
      fileResources={fileResources}
      actionGroups={actionGroups}
      modules={modules.map((m) => ({ id: m.id, title: m.title }))}
      channelId={channelId}
      selfMemberId={member.id}
      selfName={[member.first_name, member.last_name].filter(Boolean).join(' ') || undefined}
      flaggedCount={flaggedCount ?? 0}
    />
  )
}
