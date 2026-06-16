import { auth, currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase'
import { AccountProfile } from '@/components/member/AccountProfile'
import { MembershipCard } from '@/components/member/MembershipCard'
import { EventHistory } from '@/components/member/EventHistory'
import { TeamsTab } from '@/components/member/TeamsTab'
import { BillingHistory } from '@/components/member/BillingHistory'
import { DocusignsSection } from '@/components/member/DocusignsSection'
import { MyRegistrations } from '@/components/member/MyRegistrations'
import { DirectoryPrefsForm } from '@/components/community/DirectoryPrefsForm'
import { ActivityTimeline } from '@/components/activity/ActivityTimeline'
import Link from 'next/link'

export const metadata = { title: 'My Account' }

const TABS = ['profile', 'teams', 'billing', 'activity'] as const
type Tab = typeof TABS[number]

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const clerkUserRaw = await currentUser()
  const clerkUser = clerkUserRaw ? { imageUrl: clerkUserRaw.imageUrl ?? null } : null
  const db = supabaseServer()

  const [{ data: member }, { data: ethnicityOptions }, { data: allergyOptions }] = await Promise.all([
    db
      .from('members')
      .select(`
        *,
        member_schools(*, schools(*)),
        member_memberships(*, membership_tiers(*)),
        member_ethnicities(ethnicity_option_id),
        member_allergies(allergy_option_id),
        event_participations(*)
      `)
      .eq('clerk_user_id', userId)
      .maybeSingle(),
    db.from('ethnicity_options').select('id, name').order('name'),
    db.from('allergy_options').select('id, name').order('name'),
  ])

  if (!member) redirect('/account/onboarding')

  const { data: directoryPrefs } = await db
    .from('member_directory_prefs')
    .select('is_visible, show_school, show_region')
    .eq('member_id', member.id)
    .maybeSingle()

  // Activity log — the same history an admin sees on this member's admin page.
  const { data: activity } = await db
    .from('member_activity_log')
    .select('id, actor_type, actor_label, category, action, summary, metadata, created_at')
    .eq('member_id', member.id)
    .order('created_at', { ascending: false })
    .limit(30)

  // Current event registrations, with Company assignment when set (PRD 6.7)
  const { data: myParticipantRows } = await db
    .from('participants')
    .select(
      'id, membership_id, checked_in_at, event_companies(number, name), registrations(event_slug, event_title, status, type)'
    )
    .or(`member_id.eq.${member.id},email.eq.${member.email}`)
  const myRegistrations = (myParticipantRows ?? [])
    .map((p) => {
      const reg = p.registrations as unknown as {
        event_slug: string
        event_title: string
        status: string
        type: string
      } | null
      const company = p.event_companies as unknown as { number: number; name: string | null } | null
      return reg && reg.status !== 'withdrawn'
        ? {
            id: p.id as string,
            eventTitle: reg.event_title,
            status: reg.status,
            type: reg.type,
            checkedInAt: p.checked_in_at as string | null,
            company,
          }
        : null
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  // The member's canonical 7-digit Membership ID now lives on the members row
  // (migration 036). Fall back to the lowest of their participant ids for any
  // member not yet backfilled (zero-padded, so string sort == numeric order).
  const membershipId =
    (member as { membership_id?: string | null }).membership_id ??
    ((myParticipantRows ?? [])
      .map((p) => (p as { membership_id?: string | null }).membership_id)
      .filter((m): m is string => !!m)
      .sort()[0] ?? null)

  const activeMembership = member.member_memberships
    ?.filter((m: { renewal_status: string }) => m.renewal_status === 'active')
    .sort((a: { started_at: string }, b: { started_at: string }) =>
      new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
    )[0]

  // Does this member own any group registration — as the registrant (teacher or
  // student manager) or the nominated teacher POC? This is the reliable signal
  // for the Teams tab: members.event_role can't be trusted (a student manager's
  // row is 'school_student', and a teacher POC may carry any role).
  const groupOwnerOr = member.email
    ? `teacher_member_id.eq.${member.id},teacher_email.eq.${member.email},teacher_poc_email.eq.${member.email}`
    : `teacher_member_id.eq.${member.id}`
  const { count: managedGroupCount } = await db
    .from('registrations')
    .select('id', { count: 'exact', head: true })
    .eq('type', 'group')
    .or(groupOwnerOr)
  const managesGroup = (managedGroupCount ?? 0) > 0

  const { tab: rawTab } = await searchParams
  const isGroupManager =
    managesGroup ||
    member.event_role === 'teacher' ||
    member.event_role === 'school_student_manager'
  const isStudent = member.event_role === 'school_student'
  const showTeams = isGroupManager || isStudent
  const showBilling = true // all members can see their participation payment history

  // Resolve active tab
  let activeTab: Tab = 'profile'
  if (rawTab === 'teams' && showTeams) activeTab = 'teams'
  else if (rawTab === 'billing' && showBilling) activeTab = 'billing'
  else if (rawTab === 'activity') activeTab = 'activity'

  const tabLinks: { key: Tab; label: string }[] = [
    { key: 'profile', label: 'Profile' },
    ...(showTeams ? [{ key: 'teams' as Tab, label: 'Teams' }] : []),
    ...(showBilling ? [{ key: 'billing' as Tab, label: 'Billing' }] : []),
    { key: 'activity', label: 'Activity' },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Account</h1>
        <p className="mt-1 text-sm text-gray-500">Manage your Stellr membership and profile.</p>
      </div>

      {/* Tab bar — only shown when there are multiple tabs */}
      {tabLinks.length > 1 && (
        <div className="flex gap-1 border-b border-gray-200">
          {tabLinks.map(({ key, label }) => (
            <Link
              key={key}
              href={key === 'profile' ? '/account' : `/account?tab=${key}`}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === key
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
      )}

      {/* Profile tab */}
      {activeTab === 'profile' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <AccountProfile
              member={member}
              clerkUser={clerkUser}
              ethnicityOptions={ethnicityOptions ?? []}
              allergyOptions={allergyOptions ?? []}
            />
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="mb-4 text-base font-semibold text-gray-900">Community directory</h2>
              <DirectoryPrefsForm
                initial={directoryPrefs ?? { is_visible: false, show_school: true, show_region: true }}
              />
            </div>
            <MyRegistrations registrations={myRegistrations} />
            <EventHistory participations={member.event_participations ?? []} editable />
            <DocusignsSection dateOfBirth={member.date_of_birth} eventRole={member.event_role} />
          </div>
          <div>
            <MembershipCard membership={activeMembership} member={member} membershipId={membershipId} />
          </div>
        </div>
      )}

      {/* Teams tab */}
      {activeTab === 'teams' && showTeams && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            {isGroupManager
              ? 'Manage your registered teams and participant details.'
              : 'Teams you have been added to for upcoming events.'}
          </p>
          <TeamsTab role={member.event_role} memberId={member.id} />
        </div>
      )}

      {/* Billing tab */}
      {activeTab === 'billing' && showBilling && (
        <BillingHistory />
      )}

      {/* Activity tab */}
      {activeTab === 'activity' && (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-1 text-base font-semibold text-gray-900">Activity log</h2>
          <p className="mb-4 text-xs text-gray-400">
            A record of changes to your membership, profile and account.
          </p>
          <ActivityTimeline items={activity ?? []} fetchUrl="/api/members/me/activity" />
        </div>
      )}
    </div>
  )
}
