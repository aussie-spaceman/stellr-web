import { clerkClient } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { AccountProfile } from '@/components/member/AccountProfile'
import { MembershipCard } from '@/components/member/MembershipCard'
import { EventHistory } from '@/components/member/EventHistory'
import { TeamsTab } from '@/components/member/TeamsTab'
import { BillingHistory } from '@/components/member/BillingHistory'
import { DocusignsSection } from '@/components/member/DocusignsSection'
import { MyRegistrations } from '@/components/member/MyRegistrations'
import { DirectoryPrefsForm } from '@/components/community/DirectoryPrefsForm'
import { ViewAsBanner } from '@/components/admin/ViewAsBanner'

export const metadata = { title: 'Admin — View As Member' }

const TABS = ['profile', 'teams', 'billing'] as const
type Tab = typeof TABS[number]

// Read-only mirror of the member's own /account page. Everything the member can
// see, the admin sees here — the session-bound widgets (Teams, Billing) are
// pointed at this member via impersonateMemberId and rendered read-only.
export default async function ViewAsMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { id } = await params
  const db = supabaseServer()

  const [
    { data: member },
    { data: ethnicityOptions },
    { data: allergyOptions },
    { data: docusignEnvelopes },
  ] = await Promise.all([
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
      .eq('id', id)
      .maybeSingle(),
    db.from('ethnicity_options').select('id, name').order('name'),
    db.from('allergy_options').select('id, name').order('name'),
    db
      .from('docusign_envelopes')
      .select('id, envelope_id, status, envelope_type, signer_name, signer_email, minor_name, event_title, sent_at, completed_at, reminder_sent_at, reused_from, signers_total, signers_completed')
      .eq('member_id', id)
      .order('sent_at', { ascending: false }),
  ])

  if (!member) notFound()

  // The member's avatar comes from Clerk (same source as their own /account).
  let clerkUser: { imageUrl: string | null } | null = null
  if (member.clerk_user_id) {
    try {
      const client = await clerkClient()
      const u = await client.users.getUser(member.clerk_user_id)
      clerkUser = { imageUrl: u.imageUrl ?? null }
    } catch {
      // Member may not have a Clerk account yet — fall back to the placeholder.
    }
  }

  const { data: directoryPrefs } = await db
    .from('member_directory_prefs')
    .select('is_visible, show_school, show_region')
    .eq('member_id', member.id)
    .maybeSingle()

  // Participant rows back both the Membership ID and the current registrations list.
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

  // Canonical Membership ID now lives on the members row (migration 036); fall
  // back to the lowest participant id for any member not yet backfilled.
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

  const memberName = [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email

  // Gating matches the member's own /account page exactly.
  const isGroupManager = member.event_role === 'teacher' || member.event_role === 'school_student_manager'
  const isStudent = member.event_role === 'school_student'
  const showTeams = isGroupManager || isStudent
  const showBilling = true // all members can see their participation payment history

  const { tab: rawTab } = await searchParams
  let activeTab: Tab = 'profile'
  if (rawTab === 'teams' && showTeams) activeTab = 'teams'
  else if (rawTab === 'billing' && showBilling) activeTab = 'billing'

  const tabLinks: { key: Tab; label: string }[] = [
    { key: 'profile', label: 'Profile' },
    ...(showTeams ? [{ key: 'teams' as Tab, label: 'Teams' }] : []),
    ...(showBilling ? [{ key: 'billing' as Tab, label: 'Billing' }] : []),
  ]

  const tabHref = (key: Tab) =>
    key === 'profile' ? `/admin/members/${id}/view-as` : `/admin/members/${id}/view-as?tab=${key}`

  return (
    <>
      {/* Banner breaks out of admin layout's padded <main> */}
      <div className="-mx-4 -mt-10 mb-8">
        <ViewAsBanner memberId={id} memberName={memberName} />
      </div>
      <div className="max-w-5xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Account</h1>
          <p className="mt-1 text-sm text-gray-500">Manage your Stellr membership and profile.</p>
        </div>

        {/* Tab bar — mirrors the member's own /account */}
        {tabLinks.length > 1 && (
          <div className="flex gap-1 border-b border-gray-200">
            {tabLinks.map(({ key, label }) => (
              <Link
                key={key}
                href={tabHref(key)}
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
                readOnly
              />
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h2 className="mb-4 text-base font-semibold text-gray-900">Community directory</h2>
                <DirectoryPrefsForm
                  initial={directoryPrefs ?? { is_visible: false, show_school: true, show_region: true }}
                  readOnly
                />
              </div>
              <MyRegistrations registrations={myRegistrations} />
              <EventHistory participations={member.event_participations ?? []} editable={false} />
              <DocusignsSection
                initialEnvelopes={docusignEnvelopes ?? []}
                dateOfBirth={member.date_of_birth}
                eventRole={member.event_role}
                adminDownload
              />
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
            <TeamsTab
              role={member.event_role}
              memberId={member.id}
              impersonateMemberId={member.id}
              readOnly
            />
          </div>
        )}

        {/* Billing tab */}
        {activeTab === 'billing' && showBilling && (
          <BillingHistory impersonateMemberId={member.id} readOnly />
        )}
      </div>
    </>
  )
}
