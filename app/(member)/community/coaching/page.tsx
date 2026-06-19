import { redirect } from 'next/navigation'
import { formatDateShort, formatDateTime } from '@/lib/utils'
import { getCurrentMember } from '@/lib/community'
import { supabaseServer } from '@/lib/supabase'
import {
  getEntitlement,
  listMemberSessions,
  getMemberActions,
  getCoachingChannel,
} from '@/lib/sessions'
import { BookCoachingForm, type Coach } from '@/components/community/BookCoachingForm'
import { JoinButton } from '@/components/community/JoinButton'
import { ActionChecklist } from '@/components/community/ActionChecklist'
import { ChatPanel } from '@/components/community/ChatPanel'
import { MaterialDownloadButton } from '@/components/community/MaterialDownloadButton'

export const metadata = { title: 'Community · Coaching' }

export default async function CoachingPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const db = supabaseServer()
  const [ent, sessions, actions] = await Promise.all([
    getEntitlement(member, 'coaching'),
    listMemberSessions(member.id),
    getMemberActions(member.id),
  ])
  const coaching = sessions.filter((s) => s.session_type === 'coaching')

  // Available coaches: session_hosts(can_coach) + name + availability.
  const { data: hostRows } = await db
    .from('session_hosts')
    .select('member_id, bio, members!session_hosts_member_id_fkey(first_name, last_name)')
    .eq('can_coach', true)
  const hostIds = (hostRows ?? []).map((h) => h.member_id as string)
  const { data: avail } = hostIds.length
    ? await db
        .from('host_availability')
        .select('host_member_id, weekday, start_minute, end_minute')
        .in('host_member_id', hostIds)
        .in('session_type', ['coaching', 'both'])
    : { data: [] as { host_member_id: string; weekday: number; start_minute: number; end_minute: number }[] }

  const coaches: Coach[] = (hostRows ?? []).map((h) => {
    const m = Array.isArray(h.members) ? h.members[0] : h.members
    return {
      id: h.member_id as string,
      name: [m?.first_name, m?.last_name].filter(Boolean).join(' ') || 'Coach',
      bio: (h.bio as string) ?? null,
      availability: (avail ?? [])
        .filter((a) => a.host_member_id === h.member_id)
        .map((a) => ({ weekday: a.weekday, start_minute: a.start_minute, end_minute: a.end_minute })),
    }
  })

  // One persistent chat per coach the member works with.
  const coachIds = [...new Set(coaching.map((s) => s.host_member_id).filter((id): id is string => !!id))]
  const chats = await Promise.all(
    coachIds.map(async (cid) => {
      const channelId = await getCoachingChannel(member.id, cid)
      const coachName = coaches.find((c) => c.id === cid)?.name ?? 'Coach'
      return { channelId, coachName }
    })
  )

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading uppercase text-title text-brand-blue-dark">Coaching</h1>
        <p className="mt-1 text-sm text-brand-muted-soft">
          One-on-one sessions with a Stellr coach.
        </p>
      </div>

      <div className="rounded-lg border border-brand-border bg-white p-4 text-sm">
        <span className="font-semibold text-brand-blue-dark">{ent.remaining}</span> of {ent.included} included
        sessions remaining
        {ent.extraCredits > 0 && (
          <span className="text-brand-blue"> · {ent.extraCredits} purchased</span>
        )}
        {ent.expiresAt && (
          <span className="text-brand-muted-soft"> · expires {formatDateShort(ent.expiresAt)}</span>
        )}
      </div>

      <BookCoachingForm coaches={coaches} hasRemaining={ent.remaining > 0} />

      <section>
        <h2 className="mb-3 text-sm font-subheading font-semibold uppercase tracking-wide text-brand-muted-soft">My sessions</h2>
        {coaching.length === 0 ? (
          <p className="text-sm text-brand-muted-soft">No coaching sessions yet.</p>
        ) : (
          <ul className="space-y-3">
            {coaching.map((s) => {
              const upcoming = new Date(s.scheduled_start) > new Date()
              return (
                <li key={s.id} className="rounded-lg border border-brand-border bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-brand-blue-dark">{s.title ?? 'Coaching session'}</p>
                      <p className="text-sm text-brand-muted-soft">
                        {formatDateTime(s.scheduled_start)} · {s.status}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {s.status === 'scheduled' && upcoming && (
                        <JoinButton
                          sessionId={s.id}
                          scheduledStart={s.scheduled_start}
                          isHost={false}
                        />
                      )}
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
                    <p className="mt-2 rounded bg-brand-canvas px-3 py-2 text-sm text-brand-muted">
                      <span className="font-medium">Coach notes:</span> {s.host_notes}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-subheading font-semibold uppercase tracking-wide text-brand-muted-soft">My actions</h2>
        <ActionChecklist actions={actions} />
      </section>

      {chats.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-subheading font-semibold uppercase tracking-wide text-brand-muted-soft">Chat with your coach</h2>
          {chats.map((c) => (
            <ChatPanel
              key={c.channelId}
              channelId={c.channelId}
              selfMemberId={member.id}
              selfName={[member.first_name, member.last_name].filter(Boolean).join(' ') || undefined}
              title={c.coachName}
            />
          ))}
        </section>
      )}
    </div>
  )
}
