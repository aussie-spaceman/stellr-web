import { notFound, redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/community'
import { listCohortSessions, listCohortTraining, getCohortChannel } from '@/lib/sessions'
import { listModules } from '@/lib/training'
import { supabaseServer } from '@/lib/supabase'
import { ALL_TIER_NAMES } from '@/lib/tiers'
import { getWorkshopFull } from '@/lib/coaching'
import { AdminCoachingNav } from '@/components/admin/coaching/AdminCoachingNav'
import { AdminManageWorkshop } from '@/components/admin/coaching/AdminManageWorkshop'

export const metadata = { title: 'Admin · Manage workshop' }

export default async function AdminManageWorkshopPage({ params }: { params: Promise<{ id: string }> }) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')
  if (!member.isAdmin) redirect('/community/coaching')

  const { id } = await params
  const workshop = await getWorkshopFull(id)
  if (!workshop) notFound()

  const db = supabaseServer()
  const [sessions, training, modules, channelId, { data: tierRows }] = await Promise.all([
    listCohortSessions(id),
    listCohortTraining(member, id),
    listModules(member),
    getCohortChannel(id),
    db.from('membership_tiers').select('id, name').in('name', ALL_TIER_NAMES).order('sort_order'),
  ])

  const { count: flaggedCount } = await db
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('channel_id', channelId)
    .not('flagged_at', 'is', null)
    .is('deleted_at', null)

  return (
    <div className="flex gap-8">
      <AdminCoachingNav />
      <div className="min-w-0 flex-1">
        <AdminManageWorkshop
          workshop={{
            id: workshop.id,
            name: workshop.name,
            timezone: workshop.timezone,
            plannedSessions: workshop.plannedSessions,
            coachMemberId: workshop.coachMemberId,
            coachName: workshop.coachName,
            memberId: workshop.memberId,
            memberName: workshop.memberName,
            memberEmail: workshop.memberEmail,
            memberStatus: workshop.memberStatus,
            freeForTierIds: workshop.freeForTierIds,
            oneOffPriceCents: workshop.oneOffPriceCents,
          }}
          sessions={sessions.map((s) => ({ id: s.id, title: s.title, start: s.scheduled_start, end: s.scheduled_end, status: s.status, recordingStatus: s.recording_status }))}
          resources={training.map((t) => ({ moduleId: t.moduleId, title: t.title, isMandatory: t.isMandatory, dueAt: t.dueAt }))}
          modules={modules.map((m) => ({ id: m.id, title: m.title }))}
          tiers={((tierRows ?? []) as { id: string; name: string }[]).map((t) => ({ id: t.id, name: t.name }))}
          channelId={channelId}
          selfMemberId={member.id}
          selfName={[member.first_name, member.last_name].filter(Boolean).join(' ') || undefined}
          flaggedCount={flaggedCount ?? 0}
        />
      </div>
    </div>
  )
}
