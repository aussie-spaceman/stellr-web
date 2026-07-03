import { auth, currentUser } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { fireCampaignEvent } from '@/lib/email-campaigns'
import { applyGrantTrigger } from '@/lib/membership-grants'
import { normalizeEmail } from '@/lib/member-enums'
import { logActivity } from '@/lib/activity-log'
import { grantVolunteerRole, dispatchVolunteerAgreement } from '@/lib/volunteer'

// POST /api/members/onboarding — completes a member's profile after Clerk sign-up
export async function POST(req: Request) {
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

  if (!date_of_birth || !gender || !event_role) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Onboarding fields are mandatory by audience (mirrors the client wizard):
  // everyone gives a phone; students give grade/t-shirt/school + emergency
  // contact; teachers give their school/district. Volunteers are never treated
  // as students — a college-bracket volunteer skips the student requirements —
  // and must be 18+.
  const isVolunteerSignup = event_role === 'volunteer'
  const isStudentBracket = !isVolunteerSignup && (age_bracket === 'high_school' || age_bracket === 'college')
  const schoolProvided = (school_id && school_id !== 'new') || (school_id === 'new' && !!new_school_name?.trim())
  const schoolRequired = isStudentBracket || event_role === 'teacher'

  if (!phone?.trim()) {
    return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })
  }
  if (isStudentBracket && (!grade || !tshirt_size)) {
    return NextResponse.json({ error: 'Grade and t-shirt size are required' }, { status: 400 })
  }
  if (schoolRequired && !schoolProvided) {
    return NextResponse.json({ error: 'School is required' }, { status: 400 })
  }
  if (isStudentBracket && (!ec_first_name?.trim() || !ec_last_name?.trim() || !ec_email?.trim() || !ec_phone?.trim() || !ec_relationship)) {
    return NextResponse.json({ error: 'Emergency contact details are required' }, { status: 400 })
  }

  const db = supabaseServer()

  // Auto-override age_bracket if DOB indicates minor
  const dob = new Date(date_of_birth)
  const eighteenth = new Date(dob.getFullYear() + 18, dob.getMonth(), dob.getDate())
  const isMinorDob = new Date() < eighteenth
  if (isVolunteerSignup && isMinorDob) {
    return NextResponse.json({ error: 'Stellr volunteers must be 18 or older' }, { status: 400 })
  }
  const ageAtToday = new Date().getFullYear() - dob.getFullYear()
  const resolvedBracket = ageAtToday < 18 ? 'high_school' : age_bracket
  const resolvedRole = ageAtToday < 18 ? 'participant' : event_role

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
    .select('id, email, first_name, last_name')
    .eq('clerk_user_id', userId)
    .maybeSingle()

  const profileUpdates = {
    clerk_user_id: userId,
    age_bracket: resolvedBracket,
    event_role: resolvedRole,
    date_of_birth,
    gender,
    phone: phone || null,
    grade: grade || null,
    tshirt_size: tshirt_size || null,
    ec_first_name: ec_first_name || null,
    ec_last_name: ec_last_name || null,
    ec_email: ec_email || null,
    ec_phone: ec_phone || null,
    ec_relationship: ec_relationship || null,
    is_active: true,
  }

  let memberError
  let memberId: string | null = null
  if (existingMember) {
    const { error } = await db
      .from('members')
      .update(profileUpdates)
      .eq('id', existingMember.id)
    memberError = error
    memberId = existingMember.id
  } else {
    // No row linked to this Clerk id yet (webhook hasn't fired). Before inserting,
    // check whether a member already exists for this EMAIL — created by an earlier
    // event registration — and link/update it rather than spawning a duplicate.
    const clerkUser = await currentUser()
    const primaryEmail = normalizeEmail(clerkUser?.emailAddresses.find(
      (e) => e.id === clerkUser.primaryEmailAddressId
    )?.emailAddress)

    const { data: byEmail } = primaryEmail
      ? await db.from('members').select('id').eq('email', primaryEmail).maybeSingle()
      : { data: null }

    if (byEmail) {
      const { error } = await db.from('members').update(profileUpdates).eq('id', byEmail.id)
      memberError = error
      memberId = byEmail.id
    } else {
      const { data: inserted, error } = await db.from('members').insert({
        ...profileUpdates,
        first_name: clerkUser?.firstName ?? '',
        last_name: clerkUser?.lastName ?? '',
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

  if (memberId) {
    await logActivity({
      memberId,
      category: 'account',
      action: 'onboarding_completed',
      summary: 'Completed account onboarding',
      actorType: 'member',
      actorMemberId: memberId,
    }, db)
  }

  // Volunteer program signup: grant the additive volunteer role (which also adds
  // the member to the Volunteer Space) and send the Volunteer Agreement. Both are
  // idempotent / non-fatal, so a repeat profile save can't double-issue.
  if (memberId && isVolunteerSignup) {
    await grantVolunteerRole(db, memberId, { actorType: 'member', actorMemberId: memberId }, 'registration')
    const { data: volunteerMember } = await db
      .from('members')
      .select('id, first_name, last_name, email, phone, date_of_birth')
      .eq('id', memberId)
      .maybeSingle()
    if (volunteerMember) await dispatchVolunteerAgreement(db, volunteerMember)
  }

  // Link to school if provided
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

  return NextResponse.json({ success: true })
}
