import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { upsertMember } from '@/lib/member-sync'
import { linkMembersToRegistrationSchool } from '@/lib/school-link'
import { recordEventParticipationForRegistration } from '@/lib/event-participation-sync'
import { normalizeEventRole } from '@/lib/member-enums'

// POST /api/members/teams/[id]/participants — teacher adds a participant
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id: registrationId } = await params
  const db = supabaseServer()

  const { data: member } = await db
    .from('members')
    .select('id, event_role')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (member.event_role !== 'teacher') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: registration } = await db
    .from('registrations')
    .select('id, teacher_member_id')
    .eq('id', registrationId)
    .eq('type', 'group')
    .maybeSingle()

  if (!registration) return NextResponse.json({ error: 'Team not found' }, { status: 404 })
  if (registration.teacher_member_id !== member.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()

  const allowed = [
    'first_name', 'last_name', 'nickname', 'email', 'phone', 'date_of_birth',
    'grade', 'gender', 'ethnicity', 't_shirt_size', 'school_name', 'age_bracket',
    'event_role', 'dietary_requirements', 'health_conditions',
    'emergency_contact_first_name', 'emergency_contact_last_name',
    'emergency_contact_email', 'emergency_contact_phone',
    'emergency_contact_relationship',
  ]
  const insert: Record<string, unknown> = { registration_id: registrationId }
  for (const key of allowed) {
    if (key in body) insert[key] = body[key]
  }
  // Roster filters (Companies auto-assign, studentCount) match enum values.
  if ('event_role' in insert) insert.event_role = normalizeEventRole(insert.event_role)

  // Upsert a member row (non-fatal) so the person gets a member account, can be
  // linked to a school, and shows on admin member pages — parity with the
  // registration routes. The participant is saved regardless of the outcome.
  const memberId = await upsertMember(db, {
    email: body.email,
    first_name: body.first_name,
    last_name: body.last_name,
    nickname: body.nickname,
    phone: body.phone,
    date_of_birth: body.date_of_birth,
    gender: body.gender,
    grade: body.grade,
    t_shirt_size: body.t_shirt_size,
    age_bracket: body.age_bracket,
    event_role: body.event_role,
  })
  if (memberId) insert.member_id = memberId

  const { data: participant, error } = await db
    .from('participants')
    .insert(insert)
    .select()
    .single()

  if (error) {
    console.error('[teams/participants] Insert error:', error)
    return NextResponse.json({ error: 'Failed to add participant' }, { status: 500 })
  }

  // Link the new member to the group's school (from the registration record),
  // and record the event in their Event Activity (event_participations).
  if (memberId) {
    await linkMembersToRegistrationSchool(db, registrationId, [memberId])
    await recordEventParticipationForRegistration(db, registrationId, [memberId])
  }

  return NextResponse.json({ participant }, { status: 201 })
}
