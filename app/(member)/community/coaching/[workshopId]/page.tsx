import { redirect, notFound } from 'next/navigation'
import { getCurrentMember } from '@/lib/community'
import {
  listCohortSessions,
  listCohortTraining,
  getCohortChannel,
  listMessages,
} from '@/lib/sessions'
import { listMemberCohortActions, listCohortFileResources } from '@/lib/mentoring'
import { getWorkshopSpace, getWorkshopFull, getCoachingAllowance } from '@/lib/coaching'
import { googleCalendarUrl } from '@/lib/calendar'
import { WorkshopSpace } from '@/components/community/coaching/WorkshopSpace'

export const metadata = { title: 'Coaching · Workshop' }

export default async function WorkshopSpacePage({ params }: { params: Promise<{ workshopId: string }> }) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const { workshopId } = await params
  const [space, full] = await Promise.all([getWorkshopSpace(member.id, workshopId), getWorkshopFull(workshopId)])
  if (!space || !full) notFound()

  const [sessions, training, channelId, actions, messages, fileResources, allowance] = await Promise.all([
    listCohortSessions(workshopId),
    listCohortTraining(member, workshopId),
    getCohortChannel(workshopId),
    listMemberCohortActions(member.id, workshopId),
    getCohortChannel(workshopId).then((ch) => listMessages(ch)),
    listCohortFileResources(workshopId),
    getCoachingAllowance(member),
  ])

  const now = Date.now()
  const nextSession =
    sessions
      .filter((s) => s.status === 'scheduled' && new Date(s.scheduled_start).getTime() > now)
      .sort((a, b) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime())[0] ?? null

  const nextGcal = nextSession
    ? googleCalendarUrl({
        title: nextSession.title ?? 'Coaching session',
        start: new Date(nextSession.scheduled_start),
        end: nextSession.scheduled_end
          ? new Date(nextSession.scheduled_end)
          : new Date(new Date(nextSession.scheduled_start).getTime() + 90 * 60_000),
        details: 'Stellr coaching session',
        location: nextSession.join_url ?? undefined,
      })
    : null

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null

  return (
    <WorkshopSpace
      workshop={{
        id: full.id,
        name: full.name,
        timezone: full.timezone,
        coachName: full.coachName,
        memberName: full.memberName,
        isCoach: space.isCoach,
        lifecycle: space.lifecycle,
      }}
      allowanceRemaining={allowance.remaining}
      sessions={sessions.map((s) => ({
        id: s.id,
        title: s.title,
        start: s.scheduled_start,
        end: s.scheduled_end,
        status: s.status,
        recordingStatus: s.recording_status,
      }))}
      resources={training.map((t) => ({
        moduleId: t.moduleId,
        title: t.title,
        isMandatory: t.isMandatory,
        dueAt: t.dueAt,
        itemCount: t.itemCount,
        completedCount: t.completedCount,
        canAccess: t.canAccess,
      }))}
      recordings={sessions
        .filter((s) => s.recording_status === 'available')
        .map((s) => ({ id: s.id, title: s.title, start: s.scheduled_start }))}
      fileResources={fileResources.map((r) => ({
        resourceId: r.resourceId,
        title: r.title,
        fileType: r.fileType,
        isMandatory: r.isMandatory,
        dueAt: r.dueAt,
      }))}
      actions={actions.map((a) => ({ id: a.id, title: a.title, isDone: a.isDone, dueDate: a.dueDate, kind: a.kind }))}
      nextSession={
        nextSession
          ? { id: nextSession.id, title: nextSession.title, start: nextSession.scheduled_start, end: nextSession.scheduled_end, gcalUrl: nextGcal }
          : null
      }
      lastMessage={lastMessage ? { author: lastMessage.author_name, body: lastMessage.body } : null}
      channelId={channelId}
      selfMemberId={member.id}
      selfName={[member.first_name, member.last_name].filter(Boolean).join(' ') || undefined}
    />
  )
}
