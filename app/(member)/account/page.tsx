import { auth, currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase'
import { AccountProfile } from '@/components/member/AccountProfile'
import { MembershipCard } from '@/components/member/MembershipCard'
import { EventHistory } from '@/components/member/EventHistory'
import { TeamsTab } from '@/components/member/TeamsTab'
import { BillingHistory } from '@/components/member/BillingHistory'
import { DocusignsSection } from '@/components/member/DocusignsSection'
import Link from 'next/link'

export const metadata = { title: 'My Account' }

const TABS = ['profile', 'teams', 'billing'] as const
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

  const activeMembership = member.member_memberships
    ?.filter((m: { renewal_status: string }) => m.renewal_status === 'active')
    .sort((a: { started_at: string }, b: { started_at: string }) =>
      new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
    )[0]

  const { tab: rawTab } = await searchParams
  const isGroupManager = member.event_role === 'teacher' || member.event_role === 'school_student_manager'
  const isStudent = member.event_role === 'school_student'
  const showTeams = isGroupManager || isStudent
  const showBilling = true // all members can see their participation payment history

  // Resolve active tab
  let activeTab: Tab = 'profile'
  if (rawTab === 'teams' && showTeams) activeTab = 'teams'
  else if (rawTab === 'billing' && showBilling) activeTab = 'billing'

  const tabLinks: { key: Tab; label: string }[] = [
    { key: 'profile', label: 'Profile' },
    ...(showTeams ? [{ key: 'teams' as Tab, label: 'Teams' }] : []),
    ...(showBilling ? [{ key: 'billing' as Tab, label: 'Billing' }] : []),
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
            <EventHistory participations={member.event_participations ?? []} editable />
            <DocusignsSection dateOfBirth={member.date_of_birth} eventRole={member.event_role} />
          </div>
          <div>
            <MembershipCard membership={activeMembership} member={member} />
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
    </div>
  )
}
