import { auth, currentUser } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { fireCampaignEvent } from '@/lib/email-campaigns'
import { applyGrantTrigger } from '@/lib/membership-grants'
import { normalizeAgeBracket, normalizeEmail } from '@/lib/member-enums'
import { logActivity } from '@/lib/activity-log'
import { grantVolunteerRole, dispatchVolunteerAgreement, VOLUNTEER_MEMBER_COLUMNS } from '@/lib/volunteer'
import { syncMemberClassificationRole } from '@/lib/member-roles'
import { onboardingRequirements, emergencyContactComplete } from '@/lib/onboarding-requirements'
import { sendAccountConfirmation, notifyStaffOfRegistration } from '@/lib/registration-notify'
import { assertNotImpersonating } from '@/lib/impersonation'
import { dispatchMembershipAgreement } from '@/lib/membership-agreement'
import { isKnownMinorOn, isMinorOn, isUnder13On, isValidDob } from '@/lib/age'
import { checkRegistrationAge } from '@/lib/registration-eligibility'
import { mayLinkLogin, memberAgeFacts, youngestDob } from '@/lib/guardian-consent'
import {
  GUARDIAN_RELATIONSHIPS, adultRouteForMinor, ageBand, guardianConsentOnFile, isPlausibleEmail, minorSelfSignupEnabled,
  openPendingConsent, openScreenedRequest, sendConsentRequest,
} from '@/lib/pending-consent'
import { shadowSyncFields } from '@/lib/field-crypto-shadow'

// POST /api/members/onboarding — completes a member's profile after Clerk sign-up
export async function POST(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — see lib/impersonation.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json()
  const {
    event_role, age_bracket, date_of_birth, gender, phone,
    grade, tshirt_size, school_id, new_school_name,
    new_school_address_line1, new_school_address_line2,
    new_school_city, new_school_state, new_school_postcode,
    ec_first_name, ec_last_name, ec_email, ec_phone, ec_relationship,
  } = body

  // Decision 24 (3 Nov 2026): minors may register themselves, behind
  // MINOR_SELF_SIGNUP_ENABLED until the owner approves the revised Terms §4.1
  // and Privacy §2. Off, every line below behaves as on 2 Oct 2026.
  const selfSignup = minorSelfSignupEnabled()

  // The neutral age screen: the date of birth alone, asked first. It answers
  // which form comes next and, for a minor, records the date where none is on
  // file, so going back and typing an older one changes nothing.
  if (body?.stage === 'age') {
    if (!selfSignup) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return ageStage(userId, date_of_birth)
  }

  // S0 (2 Nov 2026): a real past date, as on every registration route. Every
  // age rule below reads it, and an unreadable one would be stored as given.
  // With self-sign-up on, the date is checked first: an under-13 sends only a
  // first name and a parent's email, so the adult field checks come after.
  if (selfSignup) {
    const early = checkRegistrationAge(date_of_birth)
    if (!early.ok) return NextResponse.json({ code: early.reason, error: early.error }, { status: 400 })
    const db = supabaseServer()
    const prior = await findPriorRow(db, userId)
    if (prior.row?.is_active === false) return accountClosed()
    // A date of birth on file is never swapped for a younger one here, in
    // either direction: an adult already on file who posts an under-13 date
    // gets the same answer as a minor posting an adult one, never the pending
    // path (which would wipe their profile and queue the account for purge).
    if (youngerThanOnFile(prior.row?.date_of_birth, early.dateOfBirth)) return dobOnFile()
    // COPPA: under 13 (the younger of this date and any on file), and no
    // parent's agreement on file — the pending path, not the full profile.
    const coppa = await mayLinkLogin(db, prior.row, early.dateOfBirth)
    if (!coppa.allowed) {
      // A record found only by email came from an adult's registration; it is
      // linked once that registration's guardian form is signed, as before.
      if (prior.row && !prior.linked) return guardianConsentRequired()
      // So did a linked child an adult route brought here (an admin invite, an
      // event or group registration, an event form): they keep the
      // pre-decision-24 answer, and nothing the teacher entered is touched.
      if (prior.row) {
        const route = await adultRouteForMinor(db, prior.row.id)
        if (route === 'unknown') return tryAgain()
        if (route === 'yes') return guardianConsentRequired()
      }
      return childPendingSignup(db, userId, prior, early.dateOfBirth, body)
    }
  }

  if (!date_of_birth || !gender || !event_role) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  const dobCheck = checkRegistrationAge(date_of_birth)
  if (!dobCheck.ok) {
    return NextResponse.json({ code: dobCheck.reason, error: dobCheck.error }, { status: 400 })
  }

  // Onboarding fields are mandatory by audience. Everyone gives a phone; the
  // rest comes from the SAME rule set the wizard asks by, so this can never
  // demand a field the member was never shown. Volunteers must also be 18+.
  const isVolunteerSignup = event_role === 'volunteer'
  const required = onboardingRequirements({ event_role, age_bracket, date_of_birth })
  const schoolProvided = (school_id && school_id !== 'new') || (school_id === 'new' && !!new_school_name?.trim())

  if (!phone?.trim()) {
    return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })
  }
  if (required.grade === 'required' && !grade) {
    return NextResponse.json({ error: 'Grade is required' }, { status: 400 })
  }
  if (required.tshirtSize === 'required' && !tshirt_size) {
    return NextResponse.json({ error: 'T-shirt size is required' }, { status: 400 })
  }
  if (required.school === 'required' && !schoolProvided) {
    return NextResponse.json({ error: 'School is required' }, { status: 400 })
  }
  const ec = emergencyContactComplete([ec_first_name, ec_last_name, ec_email, ec_phone, ec_relationship])
  if (required.emergencyContact === 'required' && !ec.all) {
    return NextResponse.json({ error: 'Emergency contact details are required' }, { status: 400 })
  }
  // Wherever it is not mandatory, blank is fine but half-filled is not — a name
  // with no phone number is not an emergency contact. This covers 'hidden' too:
  // editing the date of birth can stop the wizard asking after values were
  // already typed, and those still ride along in the payload.
  if (required.emergencyContact !== 'required' && ec.any && !ec.all) {
    return NextResponse.json(
      { error: 'Please complete every emergency contact field, or leave them all blank' },
      { status: 400 },
    )
  }

  const db = supabaseServer()

  // ONE age check for the whole route, exact to the day (required.isMinor, from
  // the same rule set the wizard asks by). It replaces a second, cruder
  // `thisYear - dobYear` that used to decide the two lines below: that one
  // called someone 18 from the January of their eighteenth year, so a
  // 17-year-old born in December kept whatever adult role they picked instead
  // of being resolved to a high-school participant — a minor filed as an adult.
  if (isVolunteerSignup && required.isMinor) {
    return NextResponse.json({ error: 'Stellr volunteers must be 18 or older' }, { status: 400 })
  }
  // A minor is a high-school participant whatever they selected.
  // An adult picks their bracket on the role step. A sign-up row no longer
  // carries an 'adult' default from the Clerk webhook (its age is not known
  // then), so a blank or unknown answer from an adult is 'adult', never ''.
  const resolvedBracket = required.isMinor ? 'high_school' : normalizeAgeBracket(age_bracket)
  const resolvedRole = required.isMinor ? 'participant' : event_role

  // deep review MEM-3: onboarding is a POST anyone signed in can re-run, and it
  // used to revive and rewrite whatever member row it matched. Gate a re-run
  // BEFORE any write. Find an existing row for this caller — by Clerk id, or by
  // the caller's verified Clerk email, since an admin/Clerk deactivation nulls
  // clerk_user_id so only the email still finds the row.
  const guardClerkUser = await currentUser()
  const guardEmail = normalizeEmail(
    guardClerkUser?.emailAddresses.find((e) => e.id === guardClerkUser.primaryEmailAddressId)?.emailAddress,
  )
  type PriorRow = { id: string; is_active: boolean | null; date_of_birth: string | null }
  let priorRow: PriorRow | null = null
  {
    const { data: byClerk } = await db
      .from('members')
      .select('id, is_active, date_of_birth')
      .eq('clerk_user_id', userId)
      .maybeSingle()
    priorRow = (byClerk as PriorRow | null) ?? null
    if (!priorRow && guardEmail) {
      const { data: byEmail } = await db
        .from('members')
        .select('id, is_active, date_of_birth')
        .eq('email', guardEmail)
        .maybeSingle()
      priorRow = (byEmail as PriorRow | null) ?? null
    }
  }
  if (priorRow) {
    // Owner decision (9 Oct 2026): admin "Deactivate" is a ban. A deactivated or
    // soft-deleted row must never be silently reactivated by re-running
    // onboarding — that was the only member-level ban lever, and this route
    // undid it. Fail closed; a genuine returning member is restored by staff.
    // (A separate fix bans the Clerk user too; this refuses onboarding here.)
    if (priorRow.is_active === false) return accountClosed()
    // A minor already on file may not re-submit an adult date of birth to strip
    // their own minor status — doing so would move them into an adult bracket and
    // skip the guardian-consent path and the high-school gates. The DOB on file
    // can only be corrected by an admin. "On file" includes their participant
    // rows (S0, 3 Nov 2026), the youngest usable one: an existing member who
    // joined through a link or a sheet keeps a blank member DOB while the
    // registration put theirs on the participant row, as mayLinkLogin reads it.
    const minorOnFile =
      (priorRow.date_of_birth && isMinorOn(priorRow.date_of_birth)) ||
      isKnownMinorOn((await memberAgeFacts(db, priorRow)).youngestDateOfBirth)
    if (minorOnFile && !required.isMinor) {
      return NextResponse.json(
        { error: 'Your date of birth is already on file and cannot be changed here. Please contact Stellr.' },
        { status: 403 },
      )
    }
  }

  // Decision 24: a 13–17-year-old registering THEMSELVES finishes in the
  // pending guardian-consent state. One an adult route brought here (an admin
  // invite, an event or group registration, an event form) is not a
  // self-registration: they keep the pre-decision path below (the membership
  // agreement, no pending row, no purge). A failed read decides nothing.
  let selfRegisteredMinor = false
  if (selfSignup && required.isMinor && !isVolunteerSignup) {
    const route = priorRow ? await adultRouteForMinor(db, priorRow.id) : 'no'
    if (route === 'unknown') return tryAgain()
    selfRegisteredMinor = route === 'no'
  }
  // Their emergency contact is the parent or guardian the consent form goes
  // to, so it has to be one, and not the member's own address.
  if (selfRegisteredMinor) {
    if (!(GUARDIAN_RELATIONSHIPS as readonly string[]).includes(String(ec_relationship ?? ''))) {
      return NextResponse.json(
        { code: 'guardian_required', error: 'Please give a parent or legal guardian as your contact.' },
        { status: 400 },
      )
    }
    if (!isPlausibleEmail(ec_email)) {
      return NextResponse.json({ error: "Please check your parent or guardian's email address." }, { status: 400 })
    }
    if (guardEmail && normalizeEmail(ec_email) === guardEmail) return guardianEmailIsOwn()
  }
  // No consent step when a guardian's agreement is already on file, for the
  // member or any of their participant rows (the scope mayLinkLogin reads).
  const teenNeedsConsent = selfRegisteredMinor && !(priorRow && await guardianConsentOnFile(db, priorRow.id))
  const openTeenRequest = (id: string) => openPendingConsent(db, {
    memberId: id,
    band: 'teen',
    guardianName: [ec_first_name, ec_last_name].filter(Boolean).join(' ').trim() || null,
    guardianEmail: String(ec_email),
  })

  // Self-registration is not open to Minors yet (Terms §4.1, Privacy §2, 2 Oct
  // 2026). Until the pending-consent flow exists — parent email, DocuSign
  // without an event, 30-day purge — a Minor (under 18, or in high school) may
  // only finish onboarding when an adult route already brought them here: an
  // admin invite, an event registration (which sends the guardian's consent
  // form), or a consent envelope on file.
  // With self-sign-up on (decision 24), this gate gives way to the pending
  // guardian-consent state below.
  if (!selfSignup && (required.isMinor || resolvedBracket === 'high_school')) {
    const cleared = await minorHasConsentRoute(db, userId)
    if (!cleared) {
      return NextResponse.json(
        {
          code: 'minor_self_signup_closed',
          error:
            'Students under 18, or still in high school, join Stellr through a school or event registration for now. Ask your teacher or a parent to register you for a Stellr event, and your account will be set up from there.',
        },
        { status: 403 },
      )
    }
  }

  // S0 (2 Nov 2026), COPPA: a child under 13 finishes onboarding only once a
  // parent or guardian has signed their consent form. Age is the youngest of
  // the date just given and the one on file (or, with none on file, their
  // participant rows'), so typing an older date changes nothing. This is also
  // where a self-serve sign-up the Clerk webhook held back is linked to its
  // member row by email (below), so the webhook's rule has to hold here too.
  const coppa = await mayLinkLogin(db, priorRow, dobCheck.dateOfBirth)
  if (!coppa.allowed) return guardianConsentRequired()

  // Resolve school FK
  let resolvedSchoolId: string | null = school_id && school_id !== 'new' ? school_id : null

  if (school_id === 'new' && new_school_name?.trim()) {
    const { data: existingSchool } = await db
      .from('schools')
      .select('id')
      .eq('name', new_school_name.trim())
      .maybeSingle()

    if (existingSchool) {
      resolvedSchoolId = existingSchool.id
    } else {
      const { data: newSchool, error: schoolError } = await db
        .from('schools')
        .insert({
          name: new_school_name.trim(),
          address_line1: new_school_address_line1?.trim() || null,
          address_line2: new_school_address_line2?.trim() || null,
          city: new_school_city?.trim() || null,
          state: new_school_state?.trim() || null,
          postcode: new_school_postcode?.trim() || null,
        })
        .select('id')
        .single()

      if (schoolError) {
        console.error('School insert error:', schoolError)
        return NextResponse.json({ error: 'Failed to create school' }, { status: 500 })
      }
      resolvedSchoolId = newSchool.id
    }
  }

  // Get the Clerk user's email so we can upsert by email if no member row exists yet
  // (webhook may not have fired yet in local dev)
  const { data: existingMember } = await db
    .from('members')
    .select('id, email, first_name, last_name, profile_photo_url')
    .eq('clerk_user_id', userId)
    .maybeSingle()

  // The Clerk webhook keeps no name or photo for a self sign-up (its age is not
  // known then, COPPA data minimisation). They come from the login here, now
  // the date of birth is: a name for everyone on this path, and the photo for
  // 13 and over. Only where the row has none, so a name a registration or an
  // admin entered is never overwritten. (An under-13 with no parent's
  // agreement never gets here: childPendingSignup keeps only a first name.)
  const loginFirst = guardClerkUser?.firstName?.trim() || ''
  const loginLast = guardClerkUser?.lastName?.trim() || ''
  const loginPhoto = isUnder13On(dobCheck.dateOfBirth) ? null : guardClerkUser?.imageUrl ?? null
  const fillFromLogin = (row: { first_name?: string | null; last_name?: string | null; profile_photo_url?: string | null }) => ({
    ...(!row.first_name?.trim() && loginFirst ? { first_name: loginFirst } : {}),
    ...(!row.last_name?.trim() && loginLast ? { last_name: loginLast } : {}),
    ...(!row.profile_photo_url && loginPhoto ? { profile_photo_url: loginPhoto } : {}),
  })

  const profileUpdates = {
    clerk_user_id: userId,
    age_bracket: resolvedBracket,
    event_role: resolvedRole,
    date_of_birth: dobCheck.dateOfBirth,
    gender,
    phone: phone || null,
    grade: grade || null,
    tshirt_size: tshirt_size || null,
    ec_first_name: ec_first_name || null,
    ec_last_name: ec_last_name || null,
    ec_email: ec_email || null,
    ec_phone: ec_phone || null,
    ec_relationship: ec_relationship || null,
    // Never marketing email to anyone under 18 (decision 24; plan S1).
    ...(required.isMinor ? { marketing_consent: false } : {}),
    is_active: true,
    // Clear the soft-delete stamp too. This object is also applied to a row found
    // by EMAIL below, which may be a previously soft-deleted member (Clerk
    // user.deleted sets is_active=false + deleted_at). Reviving with is_active
    // alone leaves a zombie: active to the member, deleted to every
    // `deleted_at is null` reader.
    deleted_at: null,
  }

  // A self-registered teen's pending row goes in BEFORE their profile is
  // completed, so there is never a finished minor account with no pending
  // state (and so full community access) if the write in between fails.
  let teenRequestOpen = false
  if (teenNeedsConsent && existingMember) {
    try {
      await openTeenRequest(existingMember.id)
      teenRequestOpen = true
    } catch (e) {
      console.error('[onboarding] opening the consent request failed:', e)
      return tryAgain()
    }
  }

  let memberError
  let memberId: string | null = null
  if (existingMember) {
    const { error } = await db
      .from('members')
      .update({ ...profileUpdates, ...fillFromLogin(existingMember) })
      .eq('id', existingMember.id)
    memberError = error
    memberId = existingMember.id
  } else {
    // No row linked to this Clerk id yet (webhook hasn't fired). Before inserting,
    // check whether a member already exists for this EMAIL — created by an earlier
    // event registration — and link/update it rather than spawning a duplicate.
    const clerkUser = await currentUser()
    const primary = clerkUser?.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)
    const primaryEmail = normalizeEmail(primary?.emailAddress)

    const { data: byEmail } = primaryEmail
      ? await db.from('members').select('id, clerk_user_id, first_name, last_name, profile_photo_url').eq('email', primaryEmail).maybeSingle()
      : { data: null }

    if (byEmail) {
      // S0 (2 Nov 2026): the Clerk webhook's two rules for linking by email.
      // Only an address the user has proved finds their record, and a record
      // another login already holds is never moved to this one.
      if (primary?.verification?.status !== 'verified') {
        return NextResponse.json(
          { code: 'email_not_verified', error: 'Please verify your email address, then try again.' },
          { status: 403 },
        )
      }
      if ((byEmail as { clerk_user_id: string | null }).clerk_user_id) {
        return NextResponse.json(
          { code: 'member_already_linked', error: 'This email address is already linked to another Stellr account. Please contact Stellr.' },
          { status: 409 },
        )
      }
      // Only while still unlinked, so a link made in the meantime is never overwritten.
      const { data: linked, error } = await db
        .from('members')
        .update({ ...profileUpdates, ...fillFromLogin(byEmail) })
        .eq('id', byEmail.id)
        .is('clerk_user_id', null)
        .select('id')
      if (!error && !linked?.length) {
        return NextResponse.json(
          { code: 'member_already_linked', error: 'This email address is already linked to another Stellr account. Please contact Stellr.' },
          { status: 409 },
        )
      }
      memberError = error
      memberId = byEmail.id
    } else {
      const { data: inserted, error } = await db.from('members').insert({
        ...profileUpdates,
        first_name: clerkUser?.firstName ?? '',
        last_name: clerkUser?.lastName ?? '',
        profile_photo_url: loginPhoto,
        email: primaryEmail,
      }).select('id').single()
      memberError = error
      memberId = inserted?.id ?? null
    }
  }

  if (memberError) {
    console.error('Member upsert error:', memberError)
    return NextResponse.json({ error: 'Failed to save member' }, { status: 500 })
  }
  // S4 field encryption: inert unless FIELD_CRYPTO_MODE=shadow; never fails this write.
  shadowSyncFields('members', [memberId])

  // A row that was not there before the write (inserted, or linked by email):
  // open the request now, before anything else happens. If it cannot be
  // opened, the profile goes back to unfinished (no gender, so every member
  // surface sends them back to onboarding) and nothing else runs.
  if (teenNeedsConsent && memberId && !teenRequestOpen) {
    try {
      await openTeenRequest(memberId)
    } catch (e) {
      console.error('[onboarding] opening the consent request failed:', e)
      await db.from('members').update({ gender: null }).eq('id', memberId)
      return tryAgain()
    }
  }

  if (memberId) {
    await logActivity({
      memberId,
      category: 'account',
      action: 'onboarding_completed',
      summary: 'Completed account onboarding',
      actorType: 'member',
      actorMemberId: memberId,
    }, db)

    // Seed the canonical web-app roles from the role the member just declared.
    // This is the ONLY place that knows it: the Clerk webhook fires before the
    // wizard and can only assume 'subscriber', and when a member row already
    // exists it takes its link branch and never syncs at all. Idempotent
    // insert-or-ignore, so re-saving the profile is harmless.
    // deep review MEM-3: this is UNVERIFIED self-service, so withhold global
    // MANAGE roles — a member picking "teacher"/"mentor" in the wizard must not
    // thereby grant themselves the global teacher/mentor role (and the Spaces and
    // MANAGE gates it opens). Those are granted by an admin (coach/mentor also
    // gated on background clearance, MEM-9); the classification still rides on
    // members.event_role for display.
    await syncMemberClassificationRole(db, memberId, resolvedRole, { allowManageRoles: false })
  }

  // Volunteer program signup: grant the additive volunteer role (which also adds
  // the member to the Volunteer Space) and send the Volunteer Agreement. Both are
  // idempotent / non-fatal, so a repeat profile save can't double-issue.
  if (memberId && isVolunteerSignup) {
    await grantVolunteerRole(db, memberId, { actorType: 'member', actorMemberId: memberId }, 'registration')
    const { data: volunteerMember } = await db
      .from('members')
      .select(VOLUNTEER_MEMBER_COLUMNS)
      .eq('id', memberId)
      .maybeSingle()
    if (volunteerMember) await dispatchVolunteerAgreement(db, volunteerMember)
  }

  // Link to school if provided
  let schoolName: string | null = null
  if (resolvedSchoolId) {
    // Close any previous current school links
    await db
      .from('member_schools')
      .update({ is_current: false, ended_at: new Date().toISOString().split('T')[0] })
      .eq('clerk_user_id', userId) // handled via subquery below

    if (memberId) {
      await db.from('member_schools').upsert({
        member_id: memberId,
        school_id: resolvedSchoolId,
        is_current: true,
        started_at: new Date().toISOString().split('T')[0],
      }, { onConflict: 'member_id,school_id' })

      const { data: school } = await db.from('schools').select('name').eq('id', resolvedSchoolId).maybeSingle()
      schoolName = school?.name ?? null
      await logActivity({
        memberId,
        category: 'school',
        action: 'school_linked',
        summary: `Linked to school ${school?.name ?? ''}`.trim(),
        metadata: { schoolId: resolvedSchoolId, schoolName: school?.name ?? null },
        actorType: 'member',
        actorMemberId: memberId,
      }, db)
    }
  }

  // Assign the default freemium tier via the 'signup' grant rules (admin-editable
  // in Membership Studio → Grant rules). The member row now holds resolvedBracket
  // / resolvedRole, which the rule evaluator matches on. Only when the member has
  // no active membership yet — never override a paid tier from a prior purchase.
  if (memberId) {
    const { data: existingMembership } = await db
      .from('member_memberships')
      .select('id')
      .eq('member_id', memberId)
      .eq('renewal_status', 'active')
      .maybeSingle()

    if (!existingMembership) {
      try {
        await applyGrantTrigger(memberId, 'signup', {}, db)
      } catch (e) {
        console.error('[onboarding] signup grant failed:', e)
      }
    }
  }

  // Confirm the account to the member, and tell staff someone joined. Both are
  // transactional: they bypass the campaign engine so marketing consent can't
  // suppress "your account exists". Both swallow their own errors. Sent after
  // the tier grant above so the email can name the tier the member actually got.
  if (memberId) {
    const { data: confirmed } = await db
      .from('members')
      .select('id, first_name, last_name, email, event_role, age_bracket')
      .eq('id', memberId)
      .maybeSingle()

    if (confirmed) {
      await sendAccountConfirmation(db, confirmed)
      await notifyStaffOfRegistration(db, confirmed, { schoolName })
    }
  }

  // Fire the member.created event for any active welcome campaigns. Best-effort
  // and idempotent — the campaign send ledger dedups, so repeat profile saves
  // can't re-send. Never let a campaign error break onboarding.
  if (memberId) {
    try {
      await fireCampaignEvent('member.created', memberId)
    } catch (e) {
      console.error('[onboarding] member.created campaign event failed:', e)
    }
  }

  // The Membership Agreement, for anyone joining who has no signed agreement
  // already (self-serve sign-up, an admin invite, /join all finish here).
  // Volunteers sign the mentor agreement above instead. Non-blocking: the
  // member's account is created whatever happens. An adult can sign straight
  // away; for an under-18 the parent or guardian is emailed first.
  let signNowUrl: string | null = null

  // Decision 24: a self-registered 13–17-year-old with no guardian's agreement
  // on file finishes in the pending state (opened above, before the profile
  // write). The consent request IS the membership agreement (the Student /
  // Minor form, guardian first), so it replaces the dispatch below rather than
  // adding a second form.
  if (memberId && teenNeedsConsent) {
    await logActivity({
      memberId,
      category: 'account',
      action: 'guardian_consent_requested',
      summary: 'Asked a parent or guardian to consent to this account',
      actorType: 'member',
      actorMemberId: memberId,
    }, db)
    try {
      await sendConsentRequest(db, memberId)
    } catch (e) {
      // Non-fatal: the member can resend from their account.
      console.error('[onboarding] consent request failed (non-fatal):', e)
    }
    return NextResponse.json({ success: true, signNowUrl: null, pendingConsent: 'guardian' })
  }

  if (memberId && !isVolunteerSignup) {
    try {
      const result = await dispatchMembershipAgreement(db, memberId)
      signNowUrl = result.signNowUrl ?? null
    } catch (e) {
      console.error('[onboarding] membership agreement failed (non-fatal):', e)
    }
  }

  return NextResponse.json({ success: true, signNowUrl })
}

/**
 * Whether a Minor reached onboarding by a route that already involves an adult:
 * an admin invite (account_invite_sent_at), an event registration (a
 * participants row, which dispatched the guardian's consent form), or a minor
 * consent envelope. Matches the member by Clerk id, then by the Clerk email.
 */
async function minorHasConsentRoute(db: ReturnType<typeof supabaseServer>, userId: string): Promise<boolean> {
  let { data: member } = await db
    .from('members')
    .select('id, account_invite_sent_at')
    .eq('clerk_user_id', userId)
    .maybeSingle()
  if (!member) {
    const clerkUser = await currentUser()
    const email = normalizeEmail(clerkUser?.emailAddresses.find(
      (e) => e.id === clerkUser.primaryEmailAddressId
    )?.emailAddress)
    if (email) {
      ;({ data: member } = await db.from('members').select('id, account_invite_sent_at').eq('email', email).maybeSingle())
    }
  }
  if (!member) return false
  if (member.account_invite_sent_at) return true

  const [{ count: participations }, { count: envelopes }] = await Promise.all([
    db.from('participants').select('id', { count: 'exact', head: true }).eq('member_id', member.id),
    db.from('agreements').select('id', { count: 'exact', head: true }).eq('member_id', member.id).eq('envelope_type', 'minor'),
  ])
  return (participations ?? 0) > 0 || (envelopes ?? 0) > 0
}

type Db = ReturnType<typeof supabaseServer>

function accountClosed() {
  return NextResponse.json(
    { error: 'This account has been closed. Please contact Stellr to restore access.' },
    { status: 403 },
  )
}

function guardianConsentRequired() {
  return NextResponse.json(
    {
      code: 'guardian_consent_required',
      error:
        "A parent or guardian needs to sign your Stellr consent form before you can finish setting up your account. Once they have, come back here and try again. If they can't find the form, please contact Stellr.",
    },
    { status: 403 },
  )
}

function dobOnFile() {
  return NextResponse.json(
    { error: 'Your date of birth is already on file and cannot be changed here. Please contact Stellr.' },
    { status: 403 },
  )
}

const BAND_RANK = { child: 0, teen: 1, adult: 2 } as const

/**
 * Whether `submitted` puts the member in a younger age band than the usable
 * date of birth on their own row. Nothing on file (or an unreadable date)
 * decides nothing: there is no older answer to protect.
 */
function youngerThanOnFile(onFile: string | null | undefined, submitted: string): boolean {
  if (!isValidDob(onFile)) return false
  return BAND_RANK[ageBand(submitted)] < BAND_RANK[ageBand(onFile)]
}

function tryAgain() {
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
}

function guardianEmailIsOwn() {
  return NextResponse.json(
    { code: 'guardian_email_is_own', error: "Please use your parent or guardian's own email address, not yours." },
    { status: 400 },
  )
}

interface PriorLookup {
  row: { id: string; is_active: boolean | null; date_of_birth: string | null } | null
  /** Found by this login's Clerk id (true) rather than only by its email. */
  linked: boolean
  primaryEmail: string | null
}

/** The caller's member row, by Clerk id, else by their Clerk primary email (as MEM-3 reads it). */
async function findPriorRow(db: Db, userId: string): Promise<PriorLookup> {
  const clerkUser = await currentUser()
  const primaryEmail = normalizeEmail(
    clerkUser?.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)?.emailAddress,
  ) || null
  const { data: byClerk } = await db
    .from('members')
    .select('id, is_active, date_of_birth')
    .eq('clerk_user_id', userId)
    .maybeSingle()
  if (byClerk) return { row: byClerk as PriorLookup['row'], linked: true, primaryEmail }
  if (primaryEmail) {
    const { data: byEmail } = await db
      .from('members')
      .select('id, is_active, date_of_birth')
      .eq('email', primaryEmail)
      .maybeSingle()
    if (byEmail) return { row: byEmail as PriorLookup['row'], linked: false, primaryEmail }
  }
  return { row: null, linked: false, primaryEmail }
}

/**
 * The age screen (self-sign-up on). Says which form follows — 'adult', 'teen'
 * or 'child' — without the page ever naming an age. A minor's date is written
 * to their own row when none is on file, so the band cannot be shopped for.
 */
async function ageStage(userId: string, dateOfBirth: unknown) {
  const dobCheck = checkRegistrationAge(dateOfBirth)
  if (!dobCheck.ok) return NextResponse.json({ code: dobCheck.reason, error: dobCheck.error }, { status: 400 })
  const db = supabaseServer()
  const prior = await findPriorRow(db, userId)
  if (prior.row?.is_active === false) return accountClosed()
  const onFile = prior.row ? (await memberAgeFacts(db, prior.row)).youngestDateOfBirth : null
  if (isKnownMinorOn(onFile) && !isMinorOn(dobCheck.dateOfBirth)) return dobOnFile()
  // Nor an older date on file for a younger one: an adult's account must not be
  // opened as a pending child (inactive, then purged after 30 days).
  if (youngerThanOnFile(prior.row?.date_of_birth, dobCheck.dateOfBirth)) return dobOnFile()
  const band = ageBand(youngestDob([dobCheck.dateOfBirth, onFile]))
  // Nothing is recorded for an adult, or before this login has its own row.
  if (band === 'adult' || !prior.row || !prior.linked) return NextResponse.json({ band, consented: false })
  const memberId = prior.row.id
  const recordDob = () => prior.row?.date_of_birth ? Promise.resolve() : db
    .from('members')
    .update({ date_of_birth: dobCheck.dateOfBirth, marketing_consent: false })
    .eq('id', memberId)
    .is('date_of_birth', null)
    .then(() => undefined)

  // `consented` in the answer means "no consent step follows". That is so when
  // a guardian's agreement is already on file (consent given, or an event's
  // form, for the member or any participant row of theirs), and for a minor an
  // adult route brought here (invite, event or group registration, event
  // form): not a self-registration, so no pending state and no purge.
  const route = await adultRouteForMinor(db, memberId)
  if (route === 'unknown') return tryAgain()
  const consented = await guardianConsentOnFile(db, memberId)
  if (route === 'yes' || consented) {
    await recordDob()
    // An under-13 whose parent has not signed the event's form waits for it,
    // as before decision 24. Otherwise the full minor profile follows, which
    // onboarding accepts (mayLinkLogin), so an under-13 gets the 'teen' form.
    if (band === 'child' && !consented) return guardianConsentRequired()
    return NextResponse.json({ band: 'teen', consented: true })
  }

  // A self-registration. The pending row goes in before the date of birth is
  // recorded, so a sign-up abandoned right here is still purged after 30 days
  // (COPPA: what is held to ask for consent goes if consent never comes).
  try {
    await openScreenedRequest(db, { memberId, band })
  } catch (e) {
    console.error('[onboarding] opening the consent request at the age screen failed:', e)
    return tryAgain()
  }
  await recordDob()
  return NextResponse.json({ band, consented: false })
}

/**
 * Under 13 with no parent's agreement on file (self-sign-up on). COPPA: only a
 * first name, the date of birth and a parent's email are kept until the
 * parent consents; every other profile field is cleared. The parent is sent
 * the Student / Minor agreement, signs first with the guardian attestation and
 * the birth-year check, and the account stays inactive (onboarding is not
 * complete) until then. Unanswered for 30 days, it is purged.
 */
async function childPendingSignup(
  db: Db,
  userId: string,
  prior: PriorLookup,
  dateOfBirth: string,
  body: Record<string, unknown>,
) {
  const firstName = typeof body.first_name === 'string' ? body.first_name.trim().slice(0, 80) : ''
  if (!firstName) return NextResponse.json({ error: 'Please add your first name.' }, { status: 400 })
  const parentEmail = isPlausibleEmail(body.parent_email) ? normalizeEmail(body.parent_email) : ''
  if (!parentEmail) {
    return NextResponse.json({ error: "Please add your parent or guardian's email address." }, { status: 400 })
  }
  if (prior.primaryEmail && parentEmail === prior.primaryEmail) return guardianEmailIsOwn()

  const childFields = {
    first_name: firstName,
    last_name: '',
    date_of_birth: dateOfBirth,
    age_bracket: 'high_school',
    event_role: 'participant',
    gender: null,
    phone: null,
    grade: null,
    tshirt_size: null,
    profile_photo_url: null,
    ec_first_name: null,
    ec_last_name: null,
    ec_email: null,
    ec_phone: null,
    ec_relationship: null,
    marketing_consent: false,
    is_active: true,
    deleted_at: null,
  }

  let memberId: string
  if (prior.row && prior.linked) {
    const { error } = await db.from('members').update(childFields).eq('id', prior.row.id)
    if (error) {
      console.error('[onboarding] child pending update failed:', error)
      return NextResponse.json({ error: 'Failed to save member' }, { status: 500 })
    }
    memberId = prior.row.id
  } else {
    if (!prior.primaryEmail) {
      return NextResponse.json({ error: 'Please verify your email address, then try again.' }, { status: 403 })
    }
    const { data: inserted, error } = await db
      .from('members')
      .insert({ ...childFields, clerk_user_id: userId, email: prior.primaryEmail })
      .select('id')
      .single()
    if (error || !inserted) {
      console.error('[onboarding] child pending insert failed:', error)
      return NextResponse.json({ error: 'Failed to save member' }, { status: 500 })
    }
    memberId = (inserted as { id: string }).id
  }
  // The update above erases any stored emergency contact on purpose (COPPA
  // data minimisation): the shadow ciphertext must go with it. Inert unless
  // FIELD_CRYPTO_MODE is on; never throws.
  shadowSyncFields('members', [memberId])

  try {
    await openPendingConsent(db, { memberId, band: 'child', guardianName: null, guardianEmail: parentEmail })
  } catch (e) {
    console.error('[onboarding] opening the consent request failed:', e)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
  await logActivity({
    memberId,
    category: 'account',
    action: 'guardian_consent_requested',
    summary: 'Asked a parent to consent to this account (under 13)',
    actorType: 'member',
    actorMemberId: memberId,
  }, db)
  try {
    await sendConsentRequest(db, memberId)
  } catch (e) {
    console.error('[onboarding] consent request failed (non-fatal):', e)
  }
  return NextResponse.json({ success: true, signNowUrl: null, pendingConsent: 'parent' })
}
