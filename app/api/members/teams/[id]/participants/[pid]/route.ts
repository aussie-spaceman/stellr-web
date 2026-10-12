import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { sendEmail, studentLeftTeamEmail } from '@/lib/email'
import { normalizeEventRole } from '@/lib/member-enums'
import { ownsTeam } from '@/lib/team-access'
import { assertNotImpersonating } from '@/lib/impersonation'
import { removeEventParticipation } from '@/lib/event-participation-sync'

// PATCH /api/members/teams/[id]/participants/[pid]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; pid: string }> }
) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — see lib/impersonation.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id: registrationId, pid } = await params
  const db = supabaseServer()

  const [{ data: member }, { data: registration }] = await Promise.all([
    db.from('members')
      .select('id, email')
      .eq('clerk_user_id', userId)
      .eq('is_active', true)
      .maybeSingle(),
    db.from('registrations')
      .select('id, teacher_member_id, teacher_email, teacher_poc_email')
      .eq('id', registrationId)
      .eq('type', 'group')
      .maybeSingle(),
  ])

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (!registration) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

  // Only an owner of this registration can edit participants — the registrant
  // (teacher or student manager) or the nominated teacher POC (see lib/team-access).
  if (!ownsTeam(member, registration)) {
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
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — see lib/impersonation.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

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
      .select('id, teacher_member_id, teacher_first_name, teacher_email, teacher_poc_email, event_title, event_slug')
      .eq('id', registrationId)
      .maybeSingle(),
  ])

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (!participant) return NextResponse.json({ error: 'Participant not found' }, { status: 404 })
  if (!registration) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

  // An owner (registrant — teacher or student manager — or teacher POC) can remove
  // anyone; a participant can only remove themselves.
  const isManager = ownsTeam(member, registration)
  const isSelf = participant.member_id === member.id

  if (!isManager && !isSelf) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Managers cannot delete student accounts — only remove from team
  // (we're removing the participant row, not the member account, so this is fine)

  // deep review MEM-15 (data retention): a participant row is the parent of
  // award, post-event-survey and team-profile records whose FKs are ON DELETE
  // CASCADE, so a hard delete here would erase judging awards, submitted survey
  // responses and the team profile — data policy retains for 7 years (the issued
  // credential survives via SET NULL, but the award it references would be gone).
  // Refuse to destroy retained records: if the participant holds any, the row is
  // kept (space access is still revoked below is NOT reached — we return first).
  // A migration flips these FKs to SET NULL so removal can later preserve rather
  // than erase (supabase/migrations/…_participant_retention_set_null.sql, UNAPPLIED).
  const [awards, surveyResponses, teamProfiles] = await Promise.all([
    db.from('event_award_assignments').select('id', { count: 'exact', head: true }).eq('participant_id', pid),
    db.from('survey_responses').select('id', { count: 'exact', head: true }).eq('participant_id', pid).not('submitted_at', 'is', null),
    db.from('team_profiles').select('id', { count: 'exact', head: true }).eq('participant_id', pid).not('submitted_at', 'is', null),
  ])
  // Fail closed: if any count read errored we cannot prove there is nothing to
  // lose, so treat it as "has retained records" and refuse the destructive delete.
  const retained =
    (awards.count ?? 1) > 0 || awards.error != null ||
    (surveyResponses.count ?? 1) > 0 || surveyResponses.error != null ||
    (teamProfiles.count ?? 1) > 0 || teamProfiles.error != null
  if (retained) {
    return NextResponse.json(
      {
        error:
          'This participant has event records (awards, survey responses or a team profile) that must be retained. Contact Stellr to remove them.',
      },
      { status: 409 }
    )
  }

  const { error } = await db
    .from('participants')
    .delete()
    .eq('id', pid)
    .eq('registration_id', registrationId)

  if (error) {
    console.error('[teams/participants/pid] Delete error:', error)
    return NextResponse.json({ error: 'Failed to remove participant' }, { status: 500 })
  }

  // deep review REG-10: removing the participant row alone leaves the member in
  // the event's community Space (which may be full of minors), and the next
  // registration for the event re-grants it from the cohort roster. Revoke the
  // inherited Space access now. No-ops if this member still holds another active
  // participant on the event (the row is already deleted, so the guard is clean).
  if (participant.member_id && registration.event_slug) {
    await removeEventParticipation(db, {
      memberId: participant.member_id,
      eventSlug: registration.event_slug,
    })
  }

  // Notify the organiser if a participant removed themselves
  if (isSelf && !isManager && registration.teacher_email && registration.teacher_first_name) {
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
