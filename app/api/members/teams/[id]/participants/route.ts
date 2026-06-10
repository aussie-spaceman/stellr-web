import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

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

  const { data: participant, error } = await db
    .from('participants')
    .insert(insert)
    .select()
    .single()

  if (error) {
    console.error('[teams/participants] Insert error:', error)
    return NextResponse.json({ error: 'Failed to add participant' }, { status: 500 })
  }

  return NextResponse.json({ participant }, { status: 201 })
}
