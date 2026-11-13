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
import { loadRecipientsByEnvelopeRows } from '@/lib/docusign-recipients'
import { MyRegistrations } from '@/components/member/MyRegistrations'
import { DirectoryPrefsForm } from '@/components/community/DirectoryPrefsForm'
import { ViewAsBanner } from '@/components/admin/ViewAsBanner'
import { StartViewAsSession } from '@/components/admin/StartViewAsSession'
import { authz } from '@/lib/authz'
import { roleFromClerkUser } from '@/lib/authz/decide'
import { getImpersonation } from '@/lib/impersonation'

export const metadata = { title: 'Admin — View As Member' }

const TABS = ['profile', 'teams', 'billing'] as const
type Tab = typeof TABS[number]

// Read-only mirror of the member's own /account page. Everything the member can
// see, the admin sees here. The session-bound widgets (Teams, Billing) load from
// the member APIs, which resolve to this member only while the admin holds a
// view-as ticket for them; without one, those tabs offer to start a session
// (audited, 30 minutes) instead. They took ?memberId= until S0 (Nov 2026).
export default async function ViewAsMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  await authz.page.requireAdmin({ route: '/admin/members/[id]/view-as' })
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
      .from('agreements')
      .select('id, envelope_id, status, envelope_type, signer_name, signer_email, minor_name, event_title, sent_at, completed_at, reminder_sent_at, reused_from, signers_total, signers_completed')
      .eq('member_id', id)
      .order('sent_at', { ascending: false }),
  ])

  if (!member) notFound()

  // Same recipient join the member's own portal does, so view-as shows the
  // outstanding signer rather than a bare "1 of 2 signed".
  const docusignRecipients = await loadRecipientsByEnvelopeRows(
    db,
    (docusignEnvelopes ?? []).map(e => e.id as string),
  )
  const docusignRows = (docusignEnvelopes ?? []).map(e => ({
    ...e,
    recipients: docusignRecipients.get(e.id as string) ?? [],
  }))

  // The member's avatar comes from Clerk (same source as their own /account).
  let clerkUser: { imageUrl: string | null } | null = null
  let clerkRole: unknown
  let clerkRoleKnown = !member.clerk_user_id
  if (member.clerk_user_id) {
    try {
      const client = await clerkClient()
      const u = await client.users.getUser(member.clerk_user_id)
      clerkUser = { imageUrl: u.imageUrl ?? null }
      clerkRole = roleFromClerkUser(u)
      clerkRoleKnown = true
    } catch {
      // Member may not have a Clerk account yet — fall back to the placeholder.
    }
  }

  // View-as refuses staff targets (app/api/admin/impersonation), so for staff
  // the Teams and Billing tabs say so up front rather than offer a session that
  // will be refused. Only a positive answer counts: if either lookup fails the
  // tabs offer the session as usual, and the start route still refuses. Not
  // isViewAsTargetCrew: that throws on a failed read, and it would ask Clerk a second time.
  // With no Clerk answer there is no role to compare, so nothing is asked: under shadow that
  // would read as a role mismatch for a member who has not drifted.
  const holdsDutyRow = await authz.targetHoldsDutyRow(member.id).catch(() => false)
  const crewTarget =
    holdsDutyRow ||
    (clerkRoleKnown &&
      (await authz.isCrewTargetOrUnknown(
        { clerkUserId: member.clerk_user_id ?? null, clerkRole, memberId: member.id },
        { route: '/admin/members/[id]/view-as' },
      )) === true)

  const { data: directoryPrefs } = await db
    .from('member_directory_prefs')
    .select('is_visible, show_school, show_region')
    .eq('member_id', member.id)
    .maybeSingle()

  // Participant rows back both the Membership ID and the current registrations list.
  const { data: myParticipantRows } = await db
    .from('participants')
    .select(
      'id, membership_id, checked_in_at, event_companies(number, name), registrations(id, event_slug, event_title, status, type)'
    )
    .or(`member_id.eq.${member.id},email.eq.${member.email}`)

  const myRegistrations = (myParticipantRows ?? [])
    .map((p) => {
      const reg = p.registrations as unknown as {
        id: string
        event_slug: string
        event_title: string
        status: string
        type: string
      } | null
      const company = p.event_companies as unknown as { number: number; name: string | null } | null
      return reg && reg.status !== 'withdrawn'
        ? {
            id: p.id as string,
            registrationId: reg.id,
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
  const isStudent = member.event_role === 'participant'
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

  // Teams and billing need a live view-as ticket for THIS member: the APIs
  // behind them read whoever the ticket names.
  const viewingThisMember = activeTab !== 'profile' && (await getImpersonation())?.memberId === member.id

  return (
    <>
      {/* Banner breaks out of admin layout's padded <main> */}
      <div className="-mx-4 -mt-10 mb-8">
        <ViewAsBanner memberId={id} memberName={memberName} />
      </div>
      <div className="max-w-5xl mx-auto space-y-8">
        <div>
          <h1 className="font-heading text-ds-h2 text-brand-blue-dark">My Account</h1>
          <p className="mt-1 text-sm text-brand-muted-soft">Manage your Stellr membership and profile.</p>
        </div>

        {/* Tab bar — mirrors the member's own /account */}
        {tabLinks.length > 1 && (
          <div className="flex gap-1 border-b border-brand-border">
            {tabLinks.map(({ key, label }) => (
              <Link
                key={key}
                href={tabHref(key)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === key
                    ? 'border-brand-blue text-brand-blue'
                    : 'border-transparent text-brand-muted-soft hover:text-brand-muted hover:border-brand-border'
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
              <div className="rounded-xl border border-brand-border bg-white p-5">
                <h2 className="mb-4 text-base font-semibold text-brand-blue-dark">Community directory</h2>
                <DirectoryPrefsForm
                  initial={directoryPrefs ?? { is_visible: false, show_school: true, show_region: true }}
                  readOnly
                />
              </div>
              <MyRegistrations registrations={myRegistrations} readOnly />
              <EventHistory participations={member.event_participations ?? []} editable={false} />
              <DocusignsSection
                initialEnvelopes={docusignRows}
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
            <p className="text-sm text-brand-muted-soft">
              {isGroupManager
                ? 'Manage your registered teams and participant details.'
                : 'Teams you have been added to for upcoming events.'}
            </p>
            {viewingThisMember ? (
              <TeamsTab role={member.event_role} memberId={member.id} readOnly />
            ) : crewTarget ? (
              <CrewNotViewable what="Teams" />
            ) : (
              <StartViewAsSession memberId={member.id} what="Teams" />
            )}
          </div>
        )}

        {/* Billing tab */}
        {activeTab === 'billing' && showBilling && (
          viewingThisMember ? (
            <BillingHistory readOnly />
          ) : crewTarget ? (
            <CrewNotViewable what="Billing details" />
          ) : (
            <StartViewAsSession memberId={member.id} what="Billing details" />
          )
        )}
      </div>
    </>
  )
}

// Deliberate, not a fault: one staff member does not open another's portal
// (deep review AUTH-9, S0). Group registrations they organise are on the
// admin member page, which reads them directly.
function CrewNotViewable({ what }: { what: string }) {
  return (
    <p className="rounded-ds-card border border-line bg-white p-5 text-sm text-content-body">
      View-as isn’t available for crew accounts (admins and event managers), so {what} can’t be shown here. Any group registrations they
      organise are listed on their member page.
    </p>
  )
}
