import { auth, currentUser } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

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

  const db = supabaseServer()

  // Auto-override age_bracket if DOB indicates minor
  const dob = new Date(date_of_birth)
  const ageAtToday = new Date().getFullYear() - dob.getFullYear()
  const resolvedBracket = ageAtToday < 18 ? 'high_school' : age_bracket
  const resolvedRole = ageAtToday < 18 ? 'school_student' : event_role

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
    // Webhook hasn't fired yet — fetch identity from Clerk and create the row now
    const clerkUser = await currentUser()
    const primaryEmail = clerkUser?.emailAddresses.find(
      (e) => e.id === clerkUser.primaryEmailAddressId
    )?.emailAddress ?? ''
    const { data: inserted, error } = await db.from('members').insert({
      ...profileUpdates,
      first_name: clerkUser?.firstName ?? '',
      last_name: clerkUser?.lastName ?? '',
      email: primaryEmail,
    }).select('id').single()
    memberError = error
    memberId = inserted?.id ?? null
  }

  if (memberError) {
    console.error('Member upsert error:', memberError)
    return NextResponse.json({ error: 'Failed to save member' }, { status: 500 })
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
    }
  }

  // Assign default free membership tier based on role
  const tierName = resolvedBracket === 'high_school' ? 'Explorer'
    : resolvedBracket === 'college' ? 'Advisor'
    : resolvedRole === 'teacher' ? 'Educator'
    : resolvedRole === 'mentor' ? 'Donor'
    : resolvedRole === 'parent' ? 'Parent/Guardian'
    : 'Subscriber'

  const { data: tier } = await db
    .from('membership_tiers')
    .select('id')
    .eq('name', tierName)
    .maybeSingle()

  if (tier && memberId) {
    const { data: existingMembership } = await db
      .from('member_memberships')
      .select('id')
      .eq('member_id', memberId)
      .eq('renewal_status', 'active')
      .maybeSingle()

    if (!existingMembership) {
      await db.from('member_memberships').insert({
        member_id: memberId,
        tier_id: tier.id,
        started_at: new Date().toISOString().split('T')[0],
        renewal_status: 'active',
        is_complimentary: false,
      })
    }
  }

  return NextResponse.json({ success: true })
}
