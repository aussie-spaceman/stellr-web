import { auth, currentUser } from '@clerk/nextjs/server'
import { formatDateShort } from '@/lib/utils'
import Link from 'next/link'
import { supabaseServer } from '@/lib/supabase'
import type { RegistrationPrefill } from '@/lib/registration-prefill'
import { getEventBySlug } from '@/lib/events/repo'
import { gradeBand } from '@/lib/grade-band'
import GroupJoinClient from './GroupJoinClient'

// The group join page, shared by Stellr's page and the tenant tree's. A plain function
// called by the page's own return, so Stellr's page returns the same tree as before:
// test/flow-join-golden.test.tsx.
//
// The prefill comes through `loadPrefill`, which only Stellr's page supplies. It reads
// the member's latest roster row, from any organiser, so a tenant's form must not get it.

export async function groupJoinBody({
  slug,
  token,
  loadPrefill,
  ownedHere,
  tenantMode,
}: {
  slug: string
  token: string
  loadPrefill?: () => Promise<RegistrationPrefill | null>
  /**
   * S5 A7: whether a link with this tenant_id belongs on this host. Stellr's page
   * passes it, so another tenant's link gets the unknown link's page there. The tenant
   * tree has already checked its own (lib/tenancy/tenant-records).
   */
  ownedHere?: (tenantId: string | null | undefined) => boolean
  /**
   * S5 A7: the tenant tree's page. Nothing is read from Stellr's member record, and
   * the form always collects the person's details (GroupJoinClient's tenantMode):
   * the join route takes no member profile on a tenant's event. Stellr's page leaves
   * it unset, and hands the form exactly the props it did before.
   */
  tenantMode?: boolean
}) {
  // Brand-new participants don't need an account up front — they fill their
  // details on this page and are auto-provisioned + signed in on submit (the
  // hosted Clerk sign-in widget is timeout-prone and blocks first-timers).
  // Signed-in members still get the one-click confirm path below.
  const { userId } = await auth()

  // Validate the token. The registration is fetched separately rather than
  // embedded: a bad column in an embedded select fails the WHOLE query, which
  // rendered every valid link as "Invalid Link" (registrations has no school_id —
  // it's a payload-only field used for school linking, never a column).
  const db = supabaseServer()
  const { data: tokenRow, error } = await db
    .from('group_join_tokens')
    .select('*')
    .eq('token', token)
    .eq('event_slug', slug)
    .maybeSingle()

  if (error) console.error('[group-join] token lookup error:', error)

  if (error || !tokenRow || (ownedHere && !ownedHere(tokenRow.tenant_id as string | null | undefined))) {
    return (
      <div className="bg-surface flex items-start justify-center px-4 py-10 sm:py-16">
        <div className="max-w-md text-center">
          <div className="text-5xl mb-4">🔗</div>
          <h1 className="text-xl font-bold text-ink mb-2">Invalid Link</h1>
          <p className="text-content-body mb-6">This registration link is not valid. Please check with your group organizer.</p>
          <Link href="/events" className="btn-primary">Browse Events</Link>
        </div>
      </div>
    )
  }

  if (new Date(tokenRow.expires_at) < new Date()) {
    return (
      <div className="bg-surface flex items-start justify-center px-4 py-10 sm:py-16">
        <div className="max-w-md text-center">
          <div className="text-5xl mb-4">⏰</div>
          <h1 className="text-xl font-bold text-ink mb-2">Link Expired</h1>
          <p className="text-content-body mb-6">This registration link expired on {formatDateShort(tokenRow.expires_at)}. Please contact your group organizer for a new link.</p>
          <Link href="/events" className="btn-primary">Browse Events</Link>
        </div>
      </div>
    )
  }

  const { data: regRow, error: regError } = await db
    .from('registrations')
    .select('teacher_first_name, teacher_last_name, school_name, school_address_state, registrant_role, status, member_pays_individually, adult_count, student_count')
    .eq('id', tokenRow.registration_id)
    .maybeSingle()

  if (regError || !regRow) {
    console.error('[group-join] registration lookup error:', regError, tokenRow.registration_id)
    return (
      <div className="bg-surface flex items-start justify-center px-4 py-10 sm:py-16">
        <div className="max-w-md text-center">
          <div className="text-5xl mb-4">⚠️</div>
          <h1 className="text-xl font-bold text-ink mb-2">Something went wrong</h1>
          <p className="text-content-body mb-6">We couldn&apos;t load this group registration. Please try again shortly, or contact your group organizer.</p>
          <Link href="/events" className="btn-primary">Browse Events</Link>
        </div>
      </div>
    )
  }

  const reg = regRow as {
    teacher_first_name: string; teacher_last_name: string
    school_name: string; school_address_state: string | null
    registrant_role: string; status: string
    member_pays_individually: boolean
    adult_count: number | null; student_count: number | null
  }

  // Resolve the group school's State so the join form can pre-fill Grade from DOB,
  // mirroring the individual/group forms. An existing-school pick stores only the
  // name on the registration (address columns stay null), so fall back to matching
  // the schools row by name — the same normalised, case-insensitive match the
  // school-linking helper uses.
  let schoolState: string | null = reg.school_address_state ?? null
  if (!schoolState && reg.school_name?.trim()) {
    const { data: school } = await db
      .from('schools')
      .select('state')
      .ilike('name', reg.school_name.trim().replace(/\s+/g, ' '))
      .limit(1)
      .maybeSingle()
    schoolState = school?.state ?? null
  }

  // Check if already registered
  const clerkUser = await currentUser()
  // Match on the PRIMARY address. emailAddresses[] is not ordered primary-first,
  // so [0] can be a secondary — e.g. an address left behind by an OAuth provider
  // whose email later changed — and matching on it misses the participant row,
  // showing the join form again to someone already registered.
  const memberEmail =
    clerkUser?.emailAddresses?.find((e) => e.id === clerkUser.primaryEmailAddressId)?.emailAddress ??
    clerkUser?.emailAddresses?.[0]?.emailAddress ??
    ''

  let alreadyRegistered = false
  if (memberEmail) {
    const { data: existing } = await db
      .from('participants')
      .select('id')
      .eq('registration_id', tokenRow.registration_id)
      .eq('email', memberEmail)
      .maybeSingle()
    alreadyRegistered = !!existing
  }
  // On the roster under their other address: an organiser may have added them by
  // their school address, and they sign in with their primary. Matched on the
  // address, as the join route does (lib/registration/group-join/persist).
  if (!alreadyRegistered && userId && !tenantMode) {
    const { data: member } = await db.from('members').select('school_email').eq('clerk_user_id', userId).maybeSingle()
    if (member?.school_email) {
      const { data: otherAddress } = await db
        .from('participants')
        .select('id')
        .eq('registration_id', tokenRow.registration_id)
        .eq('email', member.school_email)
        .maybeSingle()
      alreadyRegistered = !!otherAddress
    }
  }

  // Is every declared place already filled? Mirrors the cap enforced in the
  // group-join route so a forwarded link shows a clear "full" message rather than
  // a form that will be rejected. Older registrations (null counts) are never full.
  let groupFull = false
  if (!alreadyRegistered && reg.adult_count != null && reg.student_count != null) {
    const { count } = await db
      .from('participants')
      .select('*', { count: 'exact', head: true })
      .eq('registration_id', tokenRow.registration_id)
    groupFull = (count ?? 0) >= reg.adult_count + reg.student_count
  }

  const organiserName = `${reg.teacher_first_name} ${reg.teacher_last_name}`
  const organiserRole = reg.registrant_role === 'student_manager' ? 'Student Manager' : 'Teacher'

  // Grade options follow the event's eligible range. The event document is the
  // only place that range lives, and it is not on the token row — a Sanity
  // outage must not take the join form down with it, so fall back to the
  // default band rather than failing the page.
  const band = gradeBand((await getEventBySlug(slug).catch(() => null)) ?? {})

  return (
    <div className="bg-surface">
      <div className="bg-brand-blue-dark text-white py-10 px-4">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">{tokenRow.event_title}</h1>
          <p className="text-blue-300 text-sm">Group Registration — {reg.school_name}</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-10">
        {alreadyRegistered ? (
          <div className="bg-white rounded-xl border border-line p-8 text-center space-y-4">
            <div className="text-4xl">✅</div>
            <h2 className="text-xl font-bold text-ink">You&apos;re registered!</h2>
            <p className="text-content-body">You&apos;ve joined this group for <strong>{tokenRow.event_title}</strong>.</p>
            <a href="/account" className="btn-primary inline-block mt-4">View My Account →</a>
          </div>
        ) : groupFull ? (
          <div className="bg-white rounded-xl border border-line p-8 text-center space-y-4">
            <div className="text-4xl">🎟️</div>
            <h2 className="text-xl font-bold text-ink">This group is full</h2>
            <p className="text-content-body">
              Every place {organiserName} registered for <strong>{tokenRow.event_title}</strong> has been filled.
              Please contact your group organizer if you think this is a mistake.
            </p>
            <Link href={`/events/${slug}`} className="btn-primary inline-block mt-4">View Event →</Link>
          </div>
        ) : (
          <GroupJoinClient
            token={token}
            eventTitle={tokenRow.event_title}
            eventSlug={slug}
            organiserName={organiserName}
            organiserRole={organiserRole}
            schoolName={reg.school_name}
            schoolState={schoolState}
            memberPaysIndividually={reg.member_pays_individually}
            isAuthenticated={!!userId}
            prefill={userId && loadPrefill ? await loadPrefill() : null}
            gradeMin={band.min}
            gradeMax={band.max}
            {...(tenantMode ? { tenantMode: true } : {})}
          />
        )}
      </div>
    </div>
  )
}
