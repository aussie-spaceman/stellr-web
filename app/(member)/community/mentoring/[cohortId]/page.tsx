import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Lock } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import {
  getCohortSpace,
  listCohortSessions,
  listCohortTraining,
  getCohortChannel,
  listMessages,
} from '@/lib/sessions'
import { getCohortFull, listCohortRoster, listMemberCohortActions } from '@/lib/mentoring'
import { googleCalendarUrl } from '@/lib/calendar'
import { CohortSpace } from '@/components/community/mentoring/CohortSpace'

export const metadata = { title: 'Mentoring · Cohort' }

export default async function CohortSpacePage({ params }: { params: Promise<{ cohortId: string }> }) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const { cohortId } = await params
  const [space, full] = await Promise.all([getCohortSpace(member.id, cohortId), getCohortFull(cohortId)])
  if (!space || !full) notFound()

  // Archived + re-gated → header-only locked state.
  if (!space.accessible) {
    return (
      <div className="mx-auto max-w-content space-y-6">
        <Link href="/community/mentoring" className="text-[13px] font-medium text-content-muted hover:text-primary">
          ← Your cohorts
        </Link>
        <h1 className="font-display text-[30px] font-bold text-ink">{full.name}</h1>
        <div className="rounded-card border border-dashed border-line bg-white p-8 text-center">
          <Lock className="mx-auto h-6 w-6 text-content-faint" />
          <p className="mt-2 text-sm text-content-muted">
            This cohort has been archived and its content is no longer available on your current plan.
          </p>
        </div>
      </div>
    )
  }

  const [sessions, training, channelId, actions, roster, messages] = await Promise.all([
    listCohortSessions(cohortId),
    listCohortTraining(member, cohortId),
    getCohortChannel(cohortId),
    listMemberCohortActions(member.id, cohortId),
    listCohortRoster(cohortId),
    getCohortChannel(cohortId).then((ch) => listMessages(ch)),
  ])

  const now = Date.now()
  const upcoming = sessions
    .filter((s) => s.status === 'scheduled' && new Date(s.scheduled_start).getTime() > now)
    .sort((a, b) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime())
  const nextSession = upcoming[0] ?? null

  // GCal URL for the next session (built server-side; lib/calendar is server-ok).
  const nextGcal = nextSession
    ? googleCalendarUrl({
        title: nextSession.title ?? 'Mentoring session',
        start: new Date(nextSession.scheduled_start),
        end: nextSession.scheduled_end ? new Date(nextSession.scheduled_end) : new Date(new Date(nextSession.scheduled_start).getTime() + 90 * 60_000),
        details: 'Stellr mentoring session',
        location: nextSession.join_url ?? undefined,
      })
    : null

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null

  return (
    <CohortSpace
      cohort={{
        id: full.id,
        name: full.name,
        theme: full.theme,
        timezone: full.timezone,
        mentorName: full.mentorName,
        memberCount: full.memberCount,
        isMentor: space.isMentor,
        lifecycle: space.lifecycle,
      }}
      roster={roster.map((r) => ({ name: r.name, status: r.status }))}
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
      actions={actions.map((a) => ({
        id: a.id,
        title: a.title,
        isDone: a.isDone,
        dueDate: a.dueDate,
        kind: a.kind,
      }))}
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
