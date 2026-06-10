import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { DEFAULT_ROLE_FOR_BRACKET } from '@/lib/membership-rules'

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}

// POST /api/admin/members — admin manually creates a new member record
export async function POST(req: Request) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const {
    first_name, last_name, email, phone,
    date_of_birth, gender,
    age_bracket, event_role,
    grade, tshirt_size,
    school_id, new_school_name,
    new_school_address_line1, new_school_address_line2,
    new_school_city, new_school_state, new_school_postcode,
    ec_first_name, ec_last_name, ec_email, ec_phone, ec_relationship,
    health_conditions, discord_handle,
    tier_id,
  } = body

  if (!first_name || !last_name || !email) {
    return NextResponse.json({ error: 'First name, last name, and email are required' }, { status: 400 })
  }

  const db = supabaseServer()

  // Check for duplicate email
  const { data: existing } = await db
    .from('members')
    .select('id')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'A member with this email already exists' }, { status: 409 })
  }

  // Auto-override bracket/role if DOB indicates minor
  let resolvedBracket = age_bracket
  let resolvedRole = event_role
  if (date_of_birth) {
    const dob = new Date(date_of_birth)
    const age = new Date().getFullYear() - dob.getFullYear()
    if (age < 18) {
      resolvedBracket = 'high_school'
      resolvedRole = 'school_student'
    }
  }

  // Ensure role is valid for bracket
  if (!resolvedRole && resolvedBracket) {
    resolvedRole = DEFAULT_ROLE_FOR_BRACKET[resolvedBracket] ?? 'subscriber'
  }

  // Resolve school
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

  // Create member
  const { data: member, error: memberError } = await db
    .from('members')
    .insert({
      first_name: first_name.trim(),
      last_name: last_name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone || null,
      date_of_birth: date_of_birth || null,
      gender: gender || null,
      age_bracket: resolvedBracket,
      event_role: resolvedRole,
      grade: grade || null,
      tshirt_size: tshirt_size || null,
      discord_handle: discord_handle || null,
      health_conditions: health_conditions || null,
      ec_first_name: ec_first_name || null,
      ec_last_name: ec_last_name || null,
      ec_email: ec_email || null,
      ec_phone: ec_phone || null,
      ec_relationship: ec_relationship || null,
      is_active: true,
    })
    .select('id')
    .single()

  if (memberError) {
    console.error('Member insert error:', memberError)
    return NextResponse.json({ error: 'Failed to create member' }, { status: 500 })
  }

  // Link to school
  if (resolvedSchoolId) {
    await db.from('member_schools').insert({
      member_id: member.id,
      school_id: resolvedSchoolId,
      is_current: true,
      started_at: new Date().toISOString().split('T')[0],
    })
  }

  // Assign membership tier
  if (tier_id) {
    await db.from('member_memberships').insert({
      member_id: member.id,
      tier_id,
      started_at: new Date().toISOString().split('T')[0],
      renewal_status: 'active',
      is_complimentary: true,
    })
  }

  return NextResponse.json({ member: { id: member.id } }, { status: 201 })
}
