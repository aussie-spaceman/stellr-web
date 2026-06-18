import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, CalendarPlus, Lock, Video } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import {
  getCohortSpace,
  listCohortSessions,
  listCohortTraining,
  getCohortChannel,
} from '@/lib/sessions'
import { listModules } from '@/lib/training'
import { googleCalendarUrl } from '@/lib/calendar'
import { JoinButton } from '@/components/community/JoinButton'
import { ChatPanel } from '@/components/community/ChatPanel'
import { MentorCohortControls } from '@/components/community/MentorCohortControls'
import { MaterialDownloadButton } from '@/components/community/MaterialDownloadButton'

export const metadata = { title: 'Community · Cohort' }

// A Mentoring Cohort rendered as a private Space (PRD §11): group chat, scheduled
// sessions with calendar links, referenced training material, and recordings —
// all gated to the roster + mentor.
export default async function CohortSpacePage({
  params,
}: {
  params: Promise<{ cohortId: string }>
}) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const { cohortId } = await params
  const cohort = await getCohortSpace(member.id, cohortId)
  if (!cohort) notFound()

  const backLink = (
    <Link
      href="/community/mentoring"
      className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
    >
      <ArrowLeft className="h-4 w-4" /> All cohorts
    </Link>
  )

  // Archived + re-gated for this member: show header only.
  if (!cohort.accessible) {
    return (
      <div className="space-y-6">
        {backLink}
        <h1 className="text-2xl font-bold text-gray-900">{cohort.name}</h1>
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-center">
          <Lock className="mx-auto h-6 w-6 text-gray-300" />
          <p className="mt-2 text-sm text-gray-500">
            This cohort has been archived and its content is no longer available on your current plan.
          </p>
        </div>
      </div>
    )
  }

  const [sessions, training, channelId, allModules] = await Promise.all([
    listCohortSessions(cohortId),
    listCohortTraining(member, cohortId),
    getCohortChannel(cohortId),
    cohort.isMentor ? listModules(member) : Promise.resolve([]),
  ])

  const now = Date.now()
  const upcoming = sessions.filter(
    (s) => s.status === 'scheduled' && new Date(s.scheduled_start).getTime() > now,
  )
  const recordings = sessions.filter((s) => s.recording_status === 'available')

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        {backLink}
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900">{cohort.name}</h1>
          {cohort.isMentor && (
            <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">Mentor</span>
          )}
          {cohort.lifecycle === 'archived' && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">Archived</span>
          )}
        </div>
      </div>

      {/* Mentor controls */}
      {cohort.isMentor && (
        <MentorCohortControls
          cohortId={cohortId}
          modules={allModules.map((m) => ({ id: m.id, title: m.title }))}
          linkedTraining={training.map((t) => ({
            moduleId: t.moduleId,
            title: t.title,
            isMandatory: t.isMandatory,
            dueAt: t.dueAt ?? null,
          }))}
        />
      )}

      {/* Scheduled sessions */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Sessions</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-gray-400">No upcoming sessions scheduled.</p>
        ) : (
          <ul className="space-y-3">
            {upcoming.map((s) => {
              const start = new Date(s.scheduled_start)
              const end = s.scheduled_end ? new Date(s.scheduled_end) : new Date(start.getTime() + 60 * 60_000)
              const gcal = googleCalendarUrl({
                title: s.title ?? 'Mentoring session',
                start,
                end,
                details: 'Stellr mentoring session',
                location: s.join_url ?? undefined,
              })
              return (
                <li key={s.id} className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-gray-900">{s.title ?? 'Mentoring session'}</p>
                      <p className="text-sm text-gray-500">{start.toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={gcal}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        <CalendarPlus className="h-3.5 w-3.5" /> Add to Google Calendar
                      </a>
                      <JoinButton sessionId={s.id} />
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Referenced training material */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Training material</h2>
        {training.length === 0 ? (
          <p className="text-sm text-gray-400">No training has been linked to this cohort yet.</p>
        ) : (
          <ul className="space-y-2">
            {training.map((t) => {
              const done = t.itemCount > 0 && t.completedCount >= t.itemCount
              const overdue = !done && t.dueAt != null && new Date(t.dueAt).getTime() < now
              const inner = (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-4">
                  <div>
                    <p className="flex items-center gap-2 font-medium text-gray-900">
                      {t.title}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          t.isMandatory ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {t.isMandatory ? 'Mandatory' : 'Optional'}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {t.completedCount} of {t.itemCount} complete
                      {t.dueAt && (
                        <span className={overdue ? 'text-red-600' : 'text-gray-500'}>
                          {' '}· due {new Date(t.dueAt).toLocaleDateString()}
                          {overdue ? ' (overdue)' : ''}
                        </span>
                      )}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-gray-400">
                    {done ? 'Done' : t.canAccess ? 'Open →' : 'Upgrade to access'}
                  </span>
                </div>
              )
              return (
                <li key={t.moduleId}>
                  {t.canAccess ? (
                    <Link href={`/community/training/${t.moduleId}`} className="block">
                      {inner}
                    </Link>
                  ) : (
                    inner
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Recordings archive */}
      {recordings.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Recordings</h2>
          <ul className="space-y-2">
            {recordings.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-4"
              >
                <div className="flex items-center gap-2">
                  <Video className="h-4 w-4 text-gray-400" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{s.title ?? 'Mentoring session'}</p>
                    <p className="text-xs text-gray-500">{new Date(s.scheduled_start).toLocaleDateString()}</p>
                  </div>
                </div>
                <MaterialDownloadButton
                  endpoint={`/api/community/sessions/${s.id}/recording`}
                  title={`${s.title ?? 'session'}-recording`}
                  label="Watch"
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Group chat */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Cohort chat</h2>
        <ChatPanel channelId={channelId} selfMemberId={member.id} title={cohort.name} canModerate={cohort.isMentor} />
      </section>
    </div>
  )
}
