import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { upsertMember } from '@/lib/member-sync'
import { linkMembersToRegistrationSchool } from '@/lib/school-link'
import { recordEventParticipationForRegistration } from '@/lib/event-participation-sync'
import { normalizeEventRole } from '@/lib/member-enums'
import { ownsTeam } from '@/lib/team-access'
import { dispatchAgreement } from '@/lib/docusign-agreements'
import { getMemberOnFileByMembershipId } from '@/lib/member-onfile'

// POST /api/members/teams/[id]/participants — group organiser adds a participant
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
    .select('id, email')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const { data: registration } = await db
    .from('registrations')
    .select('id, teacher_member_id, teacher_email, teacher_poc_email, event_slug, event_title, school_name, school_address_state')
    .eq('id', registrationId)
    .eq('type', 'group')
    .maybeSingle()

  if (!registration) return NextResponse.json({ error: 'Team not found' }, { status: 404 })
  // Ownership by member id OR registrant email OR nominated teacher-POC email
  // (see lib/team-access). The brittle event_role === 'teacher' gate also
  // rejected student managers and the teacher POC, who both own the team.
  if (!ownsTeam(member, registration)) {
    console.warn('[teams/participants] Access denied', { registrationId, memberId: member.id })
    return NextResponse.json({ error: 'You do not have access to this team' }, { status: 403 })
  }

  const body = await req.json()

  const allowed = [
    'membership_id',
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

  // Duplicate guard — the optional Member ID lets the organiser catch someone
  // who is already on the roster (e.g. added via the sheet) before re-adding
  // them. Match on membership_id when supplied, otherwise on email.
  const membershipId = (body.membership_id ?? '').toString().trim()
  const email = (body.email ?? '').toString().trim()
  if (membershipId || email) {
    const { data: dupe } = await db
      .from('participants')
      .select('id')
      .eq('registration_id', registrationId)
      .or(membershipId ? `membership_id.eq.${membershipId},email.eq.${email}` : `email.eq.${email}`)
      .maybeSingle()
    if (dupe) {
      return NextResponse.json({ error: 'This person is already on the team roster.' }, { status: 409 })
    }
  }

  // Member-ID-linked: build from the existing member's on-file record, reuse
  // their member (never overwrite), and skip the upsert below — same contract as
  // the group registration route.
  let linkedMemberId: string | null = null
  if (body.linked && membershipId) {
    const onFile = await getMemberOnFileByMembershipId(db, membershipId)
    if (onFile) {
      linkedMemberId = onFile.memberId
      Object.assign(insert, {
        first_name: onFile.first_name, last_name: onFile.last_name, nickname: onFile.nickname,
        email: onFile.email, phone: onFile.phone, date_of_birth: onFile.date_of_birth,
        grade: onFile.grade, gender: onFile.gender, t_shirt_size: onFile.t_shirt_size,
        ethnicity: onFile.ethnicity, dietary_requirements: onFile.dietary_requirements,
        health_conditions: onFile.health_conditions,
        emergency_contact_first_name: onFile.emergency_contact_first_name,
        emergency_contact_last_name: onFile.emergency_contact_last_name,
        emergency_contact_email: onFile.emergency_contact_email,
        emergency_contact_phone: onFile.emergency_contact_phone,
        emergency_contact_relationship: onFile.emergency_contact_relationship,
        event_role: normalizeEventRole(onFile.event_role ?? insert.event_role),
        member_id: onFile.memberId,
      })
    }
  }

  // Upsert a member row (non-fatal) so the person gets a member account, can be
  // linked to a school, and shows on admin member pages — parity with the
  // registration routes. The participant is saved regardless of the outcome.
  const memberId = linkedMemberId ?? await upsertMember(db, {
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

  // Issue the correct DocuSign agreement — same paperwork flow as the join link.
  // Non-fatal: the participant is saved regardless of DocuSign's outcome.
  await dispatchAgreement(db, {
    participantId:     participant.id,
    memberId,
    eventSlug:         registration.event_slug,
    eventTitle:        registration.event_title,
    firstName:         participant.first_name,
    lastName:          participant.last_name,
    email:             participant.email,
    phone:             participant.phone,
    dateOfBirth:       participant.date_of_birth,
    eventRole:         participant.event_role,
    schoolName:        participant.school_name ?? registration.school_name ?? undefined,
    schoolState:       registration.school_address_state ?? undefined,
    guardianFirstName: participant.emergency_contact_first_name ?? undefined,
    guardianLastName:  participant.emergency_contact_last_name ?? undefined,
    guardianEmail:     participant.emergency_contact_email ?? undefined,
    guardianPhone:     participant.emergency_contact_phone ?? undefined,
    relationship:      participant.emergency_contact_relationship ?? undefined,
  })

  return NextResponse.json({ participant }, { status: 201 })
}
