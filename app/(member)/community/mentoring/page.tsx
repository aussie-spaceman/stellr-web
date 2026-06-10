import { redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/community'
import { supabaseServer } from '@/lib/supabase'
import {
  getEntitlement,
  listMemberSessions,
  getMemberActions,
  getCohortChannel,
} from '@/lib/sessions'
import { JoinButton } from '@/components/community/JoinButton'
import { ActionChecklist } from '@/components/community/ActionChecklist'
import { ChatPanel } from '@/components/community/ChatPanel'
import { MaterialDownloadButton } from '@/components/community/MaterialDownloadButton'

export const metadata = { title: 'Community · Mentoring' }

export default async function MentoringPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const db = supabaseServer()
  const [ent, sessions, actions] = await Promise.all([
    getEntitlement(member, 'mentoring'),
    listMemberSessions(member.id),
    getMemberActions(member.id),
  ])
  const mentoring = sessions.filter((s) => s.session_type === 'mentoring')

  // Cohorts the member belongs to → group chat each.
  const { data: cm } = await db
    .from('cohort_members')
    .select('cohort_id, mentoring_cohorts(name)')
    .eq('member_id', member.id)
  const cohorts = (cm ?? []).map((r) => {
    const c = Array.isArray(r.mentoring_cohorts) ? r.mentoring_cohorts[0] : r.mentoring_cohorts
    return { id: r.cohort_id as string, name: (c as { name: string } | null)?.name ?? 'Cohort' }
  })
  const chats = await Promise.all(
    cohorts.map(async (c) => ({ ...c, channelId: await getCohortChannel(c.id) }))
  )

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mentoring</h1>
        <p className="mt-1 text-sm text-gray-500">
          Small-group mentoring with a Stellr-approved mentor.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
        <span className="font-semibold text-gray-900">{ent.remaining}</span> of {ent.included} included
        sessions remaining
        {ent.expiresAt && (
          <span className="text-gray-500"> · expires {new Date(ent.expiresAt).toLocaleDateString()}</span>
        )}
      </div>

      {cohorts.length === 0 && (
        <p className="text-sm text-gray-400">
          You&apos;re not in a mentoring cohort yet. An administrator will add you to one.
        </p>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Sessions</h2>
        {mentoring.length === 0 ? (
          <p className="text-sm text-gray-400">No mentoring sessions scheduled.</p>
        ) : (
          <ul className="space-y-3">
            {mentoring.map((s) => {
              const upcoming = new Date(s.scheduled_start) > new Date()
              return (
                <li key={s.id} className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-gray-900">{s.title ?? 'Mentoring session'}</p>
                      <p className="text-sm text-gray-500">
                        {new Date(s.scheduled_start).toLocaleString()} · {s.status}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {s.status === 'scheduled' && upcoming && <JoinButton sessionId={s.id} />}
                      {s.recording_status === 'available' && (
                        <MaterialDownloadButton
                          endpoint={`/api/community/sessions/${s.id}/recording`}
                          title={`${s.title ?? 'session'}-recording`}
                          label="Recording"
                        />
                      )}
                    </div>
                  </div>
                  {s.host_notes && (
                    <p className="mt-2 rounded bg-gray-50 px-3 py-2 text-sm text-gray-600">
                      <span className="font-medium">Mentor notes:</span> {s.host_notes}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">My actions</h2>
        <ActionChecklist actions={actions} />
      </section>

      {chats.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Cohort chat</h2>
          {chats.map((c) => (
            <ChatPanel
              key={c.channelId}
              channelId={c.channelId}
              selfMemberId={member.id}
              title={c.name}
            />
          ))}
        </section>
      )}
    </div>
  )
}
