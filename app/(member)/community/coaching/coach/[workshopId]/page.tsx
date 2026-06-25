import { redirect, notFound } from 'next/navigation'
import { getCurrentMember } from '@/lib/community'
import { isCohortMentor, listCohortSessions, listCohortTraining, getCohortChannel } from '@/lib/sessions'
import { listModules } from '@/lib/training'
import { supabaseServer } from '@/lib/supabase'
import { getWorkshopFull } from '@/lib/coaching'
import { listCohortActionsForMentor, listCohortFileResources } from '@/lib/mentoring'
import { ManageWorkshop } from '@/components/community/coaching/ManageWorkshop'

export const metadata = { title: 'Coaching · Manage workshop' }

export default async function ManageWorkshopPage({ params }: { params: Promise<{ workshopId: string }> }) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const { workshopId } = await params
  const workshop = await getWorkshopFull(workshopId)
  if (!workshop) notFound()

  const allowed = member.isAdmin || (await isCohortMentor(workshopId, member.id))
  if (!allowed) redirect(`/community/coaching/${workshopId}`)

  const [sessions, training, actionGroups, modules, channelId, fileResources] = await Promise.all([
    listCohortSessions(workshopId),
    listCohortTraining(member, workshopId),
    listCohortActionsForMentor(workshopId),
    listModules(member),
    getCohortChannel(workshopId),
    listCohortFileResources(workshopId),
  ])

  const db = supabaseServer()
  const { count: flaggedCount } = await db
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('channel_id', channelId)
    .not('flagged_at', 'is', null)
    .is('deleted_at', null)

  return (
    <ManageWorkshop
      workshop={{
        id: workshop.id,
        name: workshop.name,
        timezone: workshop.timezone,
        plannedSessions: workshop.plannedSessions,
        memberName: workshop.memberName,
        coachName: workshop.coachName,
      }}
      sessions={sessions.map((s) => ({ id: s.id, title: s.title, start: s.scheduled_start, end: s.scheduled_end, status: s.status, recordingStatus: s.recording_status }))}
      resources={training.map((t) => ({ moduleId: t.moduleId, title: t.title, isMandatory: t.isMandatory, dueAt: t.dueAt }))}
      actionGroups={actionGroups}
      modules={modules.map((m) => ({ id: m.id, title: m.title }))}
      fileResources={fileResources}
      channelId={channelId}
      selfMemberId={member.id}
      selfName={[member.first_name, member.last_name].filter(Boolean).join(' ') || undefined}
      flaggedCount={flaggedCount ?? 0}
    />
  )
}
