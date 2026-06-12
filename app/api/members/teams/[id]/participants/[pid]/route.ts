import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { sendEmail, studentLeftTeamEmail } from '@/lib/email'
import { normalizeEventRole } from '@/lib/member-enums'

// PATCH /api/members/teams/[id]/participants/[pid]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; pid: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id: registrationId, pid } = await params
  const db = supabaseServer()

  const [{ data: member }, { data: registration }] = await Promise.all([
    db.from('members')
      .select('id, event_role')
      .eq('clerk_user_id', userId)
      .eq('is_active', true)
      .maybeSingle(),
    db.from('registrations')
      .select('id, teacher_member_id')
      .eq('id', registrationId)
      .eq('type', 'group')
      .maybeSingle(),
  ])

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (!registration) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

  // Only the teacher who owns this registration can edit participants
  if (member.event_role !== 'teacher' || registration.teacher_member_id !== member.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const allowed = [
    'first_name', 'last_name', 'nickname', 'email', 'phone', 'date_of_birth',
    'grade', 'gender', 'ethnicity', 't_shirt_size', 'school_name', 'age_bracket',
    'event_role', 'dietary_requirements', 'health_conditions',
    'emergency_contact_first_name', 'emergency_contact_last_name',
    'emergency_contact_email', 'emergency_contact_phone',
    'emergency_contact_relationship',
  ]
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }
  // Roster filters (Companies auto-assign, studentCount) match enum values.
  if ('event_role' in updates) updates.event_role = normalizeEventRole(updates.event_role)

  const { data: participant, error } = await db
    .from('participants')
    .update(updates)
    .eq('id', pid)
    .eq('registration_id', registrationId)
    .select()
    .single()

  if (error) {
    console.error('[teams/participants/pid] Update error:', error)
    return NextResponse.json({ error: 'Failed to update participant' }, { status: 500 })
  }

  return NextResponse.json({ participant })
}

// DELETE /api/members/teams/[id]/participants/[pid]
// Teacher can remove any participant; student can only remove themselves.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; pid: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id: registrationId, pid } = await params
  const db = supabaseServer()

  const [{ data: member }, { data: participant }, { data: registration }] = await Promise.all([
    db.from('members')
      .select('id, event_role, first_name, last_name, email')
      .eq('clerk_user_id', userId)
      .eq('is_active', true)
      .maybeSingle(),
    db.from('participants')
      .select('id, member_id, event_role, first_name, last_name, email')
      .eq('id', pid)
      .eq('registration_id', registrationId)
      .maybeSingle(),
    db.from('registrations')
      .select('id, teacher_member_id, teacher_first_name, teacher_email, event_title')
      .eq('id', registrationId)
      .maybeSingle(),
  ])

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (!participant) return NextResponse.json({ error: 'Participant not found' }, { status: 404 })
  if (!registration) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

  const isTeacher = member.event_role === 'teacher' && registration.teacher_member_id === member.id
  const isSelf = participant.member_id === member.id

  if (!isTeacher && !isSelf) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Teachers cannot delete student accounts — only remove from team
  // (we're removing the participant row, not the member account, so this is fine)

  const { error } = await db
    .from('participants')
    .delete()
    .eq('id', pid)
    .eq('registration_id', registrationId)

  if (error) {
    console.error('[teams/participants/pid] Delete error:', error)
    return NextResponse.json({ error: 'Failed to remove participant' }, { status: 500 })
  }

  // Notify teacher if a student removed themselves
  if (isSelf && !isTeacher && registration.teacher_email && registration.teacher_first_name) {
    const tmpl = studentLeftTeamEmail({
      teacherFirstName: registration.teacher_first_name,
      studentFirstName: participant.first_name,
      studentLastName: participant.last_name,
      studentEmail: participant.email,
      eventTitle: registration.event_title,
    })
    await sendEmail({ to: registration.teacher_email, ...tmpl }).catch(err => {
      console.error('[teams/participants/pid] Email error:', err)
    })
  }

  return NextResponse.json({ success: true })
}
