import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

// GET /api/members/me — fetch the current member's full record
export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = supabaseServer()

  const { data: member, error } = await db
    .from('members')
    .select(`
      *,
      member_schools(*, schools(*)),
      member_memberships(*, membership_tiers(*)),
      member_ethnicities(*, ethnicity_options(*)),
      member_allergies(*, allergy_options(*)),
      event_participations(*)
    `)
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    console.error('Error fetching member:', error)
    return NextResponse.json({ error: 'Failed to fetch member' }, { status: 500 })
  }

  return NextResponse.json({ member })
}

// PATCH /api/members/me — update the current member's profile
export async function PATCH(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json()
  const db = supabaseServer()

  const { data: member } = await db
    .from('members')
    .select('id')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .single()

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  // Only allow safe fields to be updated by the member themselves
  const allowed = [
    'nickname', 'phone', 'discord_handle', 'gender',
    'grade', 'tshirt_size', 'profile_photo_url',
    'ec_first_name', 'ec_last_name', 'ec_email', 'ec_phone',
    'health_conditions',
  ]
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await db
      .from('members')
      .update(updates)
      .eq('id', member.id)

    if (error) {
      console.error('Error updating member:', error)
      return NextResponse.json({ error: 'Failed to update member' }, { status: 500 })
    }
  }

  // Replace ethnicity selections
  if ('ethnicity_ids' in body && Array.isArray(body.ethnicity_ids)) {
    await db.from('member_ethnicities').delete().eq('member_id', member.id)
    if (body.ethnicity_ids.length > 0) {
      await db.from('member_ethnicities').insert(
        body.ethnicity_ids.map((eid: string) => ({ member_id: member.id, ethnicity_option_id: eid }))
      )
    }
  }

  // Replace allergy selections
  if ('allergy_ids' in body && Array.isArray(body.allergy_ids)) {
    await db.from('member_allergies').delete().eq('member_id', member.id)
    if (body.allergy_ids.length > 0) {
      await db.from('member_allergies').insert(
        body.allergy_ids.map((aid: string) => ({ member_id: member.id, allergy_option_id: aid }))
      )
    }
  }

  return NextResponse.json({ success: true })
}
