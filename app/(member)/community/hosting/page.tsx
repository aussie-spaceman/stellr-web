import { redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/community'
import { supabaseServer } from '@/lib/supabase'
import { getHostCaps, getAvailability, listHostSessions } from '@/lib/sessions'
import { AvailabilityEditor, type Window } from '@/components/community/AvailabilityEditor'
import { ScheduleMentoringForm } from '@/components/community/ScheduleMentoringForm'
import { HostSessionControls } from '@/components/community/HostSessionControls'
import { JoinButton } from '@/components/community/JoinButton'

export const metadata = { title: 'Community · Hosting' }

// Coach/mentor console (FR-COM-11/12). Only reachable by approved hosts.
export default async function HostingPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const caps = await getHostCaps(member.id)
  if (!caps.canCoach && !caps.canMentor) {
    return (
      <div className="mx-auto max-w-lg text-center">
        <h1 className="text-2xl font-bold text-gray-900">Hosting</h1>
        <p className="mt-2 text-sm text-gray-500">
          This area is for approved coaches and mentors. Contact an administrator if you should have
          access.
        </p>
      </div>
    )
  }

  const db = supabaseServer()
  const [windows, sessions] = await Promise.all([
    getAvailability(member.id),
    listHostSessions(member.id),
  ])

  const { data: cohortRows } = caps.canMentor
    ? await db.from('mentoring_cohorts').select('id, name').eq('mentor_member_id', member.id).eq('is_active', true)
    : { data: [] as { id: string; name: string }[] }

  const completed = sessions.filter((s) => s.status === 'completed').length
  const upcoming = sessions.filter(
    (s) => s.status === 'scheduled' && new Date(s.scheduled_start) > new Date()
  ).length

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Hosting</h1>
        <p className="mt-1 text-sm text-gray-500">
          {[caps.canCoach && 'Coach', caps.canMentor && 'Mentor'].filter(Boolean).join(' · ')} ·{' '}
          {completed} completed · {upcoming} upcoming
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Availability</h2>
        <AvailabilityEditor windows={windows as Window[]} />
      </section>

      {caps.canMentor && (cohortRows ?? []).length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Schedule a mentoring session
          </h2>
          <ScheduleMentoringForm cohorts={cohortRows ?? []} />
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Your sessions</h2>
        {sessions.length === 0 ? (
          <p className="text-sm text-gray-400">No sessions yet.</p>
        ) : (
          <ul className="space-y-3">
            {sessions.map((s) => {
              const upcomingSession = new Date(s.scheduled_start) > new Date()
              return (
                <li key={s.id} className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-gray-900">
                        {s.title ?? 'Session'}{' '}
                        <span className="text-xs font-normal text-gray-400">({s.session_type})</span>
                      </p>
                      <p className="text-sm text-gray-500">
                        {new Date(s.scheduled_start).toLocaleString()} · {s.status}
                      </p>
                    </div>
                    {s.status === 'scheduled' && upcomingSession && <JoinButton sessionId={s.id} />}
                  </div>
                  <HostSessionControls
                    sessionId={s.id}
                    memberId={s.member_id}
                    initialNotes={s.host_notes}
                    status={s.status}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </section>
      {/* Coach notes board — all completed sessions with notes */}
      {caps.canCoach && (() => {
        const noted = sessions.filter((s) => s.status === 'completed' && s.host_notes)
        if (noted.length === 0) return null
        return (
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Session notes</h2>
            <ul className="space-y-2">
              {noted.map((s) => (
                <li key={s.id} className="rounded-lg border border-gray-200 bg-white p-3">
                  <p className="text-xs text-gray-400">
                    {new Date(s.scheduled_start).toLocaleDateString()} · {s.title ?? 'Session'}
                  </p>
                  <p className="mt-1 text-sm text-gray-700">{s.host_notes}</p>
                </li>
              ))}
            </ul>
          </section>
        )
      })()}
    </div>
  )
}
