import type { SupabaseClient } from '@supabase/supabase-js'
import { upsertMember } from '@/lib/member-sync'
import { linkMembersToRegistrationSchool } from '@/lib/school-link'
import { recordEventParticipationForRegistration } from '@/lib/event-participation-sync'
import { normalizeEventRole } from '@/lib/member-enums'
import { dispatchAgreement } from '@/lib/docusign-agreements'
import { getMemberOnFileByMembershipId } from '@/lib/member-onfile'
import { ensureIndividualPayments } from '@/lib/individual-payment'
import { shadowSyncFields } from '@/lib/field-crypto-shadow'
import { applyRosterChange, type Actor } from '@/lib/group-billing'
import { stripeClient } from '@/lib/stripe'
import { checkRegistrationAge } from '@/lib/registration-eligibility'
import { resolveEmailPair } from '@/lib/member-email'

// Adding one person to a group registration's roster (4 Nov 2026).
//
// Shared by the organiser's Teams page (POST /api/members/teams/[id]/participants)
// and the admin event roster (POST /api/admin/registrations/[id]/participants),
// so an admin-added participant goes through exactly what an organiser-added one
// does: duplicate guard, Member ID link, age check, member upsert that never
// rewrites an existing member, school link, event activity, consent form,
// individual payment link and the group-billing step. The callers own the
// access check; this function trusts that the caller may add to this group.

export interface GroupForAdd {
  id: string
  event_slug: string
  event_title: string | null
  school_name: string | null
  school_address_state: string | null
}

export const GROUP_FOR_ADD_COLUMNS = 'id, event_slug, event_title, school_name, school_address_state'

export interface AddParticipantResult {
  status: number
  body: Record<string, unknown>
  /** The member the new roster row is linked to, when one was found or made. */
  memberId?: string | null
}

const ALLOWED = [
  'membership_id',
  'first_name', 'last_name', 'nickname', 'email', 'phone', 'date_of_birth',
  'grade', 'gender', 'ethnicity', 't_shirt_size', 'school_name', 'age_bracket',
  'event_role', 'dietary_requirements', 'health_conditions',
  'emergency_contact_first_name', 'emergency_contact_last_name',
  'emergency_contact_email', 'emergency_contact_phone',
  'emergency_contact_relationship',
]

export async function addParticipantToGroup(
  db: SupabaseClient,
  registration: GroupForAdd,
  body: Record<string, unknown>,
  actor: Actor,
): Promise<AddParticipantResult> {
  const registrationId = registration.id
  const logTag = actor.label === 'admin' ? '[admin/registrations/participants]' : '[teams/participants]'

  const insert: Record<string, unknown> = { registration_id: registrationId }
  for (const key of ALLOWED) {
    if (key in body) insert[key] = body[key]
  }
  // Roster filters (Companies auto-assign, studentCount) match enum values.
  if ('event_role' in insert) insert.event_role = normalizeEventRole(insert.event_role)
  // Personal takes primacy: with only a school address, it is the primary.
  const emails = resolveEmailPair({ email: body.email, school_email: body.school_email })
  insert.email = emails.email
  insert.school_email = emails.school_email

  // Duplicate guard — the optional Member ID lets the organiser catch someone
  // who is already on the roster (e.g. added via the sheet) before re-adding
  // them. Match on membership_id when supplied, otherwise on email.
  const membershipId = (body.membership_id ?? '').toString().trim()
  const email = emails.email
  if (membershipId || email) {
    const { data: dupe } = await db
      .from('participants')
      .select('id')
      .eq('registration_id', registrationId)
      .or(membershipId ? `membership_id.eq.${membershipId},email.eq.${email}` : `email.eq.${email}`)
      .maybeSingle()
    if (dupe) {
      return { status: 409, body: { error: 'This person is already on the team roster.' } }
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

  // S0 (2 Nov 2026): the same date-of-birth check as the registration routes,
  // before anything is written. Age is taken on today's date; this path has no
  // event date.
  const ageCheck = checkRegistrationAge(insert.date_of_birth, {
    name: [insert.first_name, insert.last_name].filter(Boolean).join(' ').trim() || 'this person',
  })
  if (!ageCheck.ok) {
    const error = !linkedMemberId
      ? ageCheck.error
      : ageCheck.reason === 'dob_missing'
        ? "We don't have a date of birth on file for this Stellr Member ID. Ask them to add it to their profile, or enter their details by hand."
        : "The date of birth on file for this Stellr Member ID doesn't look right. Ask them to contact Stellr to correct it, or enter their details by hand."
    return { status: 400, body: { code: ageCheck.reason, error } }
  }
  insert.date_of_birth = ageCheck.dateOfBirth
  // A minor takes part as a student, whatever role and bracket were picked —
  // the registration routes' rule (a school student manager stays one).
  if (ageCheck.isMinor) {
    if (insert.event_role !== 'school_student_manager') insert.event_role = 'participant'
    insert.age_bracket = 'high_school'
  }

  // participants has NOT NULL text columns the form does not always fill
  // (4 Nov 2026). school_name was never sent by the participant form, so every
  // add failed at the insert, AFTER the member row had been created: the person
  // got an account but no roster row (how one student came to have two
  // records). The group's own school is the default; the other columns take ''
  // when blank (a Member-ID link copies nulls from the member's record).
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v))
  insert.school_name = text(insert.school_name) || registration.school_name || ''
  insert.phone = text(insert.phone)
  insert.gender = text(insert.gender)
  insert.t_shirt_size = text(insert.t_shirt_size)
  insert.event_role = text(insert.event_role) || 'participant'
  insert.age_bracket = text(insert.age_bracket) || (ageCheck.isMinor ? 'high_school' : 'adult')

  // Upsert a member row (non-fatal) so the person gets a member account, can be
  // linked to a school, and shows on admin member pages. An existing member is
  // linked, never rewritten (`onExisting: 'skip'`): neither an organiser nor
  // this form is the authority on another person's date of birth, role or
  // guardian, and the COPPA guard reads the member row's date of birth first.
  const memberId = linkedMemberId ?? await upsertMember(db, {
    email: emails.email,
    school_email: emails.school_email,
    first_name: body.first_name as string,
    last_name: body.last_name as string,
    nickname: body.nickname as string | null | undefined,
    phone: body.phone as string | null | undefined,
    date_of_birth: ageCheck.dateOfBirth,
    gender: body.gender,
    grade: body.grade,
    t_shirt_size: body.t_shirt_size,
    age_bracket: insert.age_bracket,
    event_role: insert.event_role,
  }, { onExisting: 'skip' })
  if (memberId) insert.member_id = memberId

  const { data: participant, error } = await db
    .from('participants')
    .insert(insert)
    .select()
    .single()

  if (error || !participant) {
    console.error(`${logTag} Insert error:`, error)
    return { status: 500, body: { error: 'Failed to add participant' }, memberId }
  }
  // S4 field encryption: inert unless FIELD_CRYPTO_MODE=shadow; never fails this write.
  shadowSyncFields('participants', [participant.id as string])

  // Link the new member to the group's school (from the registration record),
  // and record the event in their Event Activity (event_participations).
  if (memberId) {
    await linkMembersToRegistrationSchool(db, registrationId, [memberId])
    await recordEventParticipationForRegistration(db, registrationId, [memberId])
  }

  // Issue the correct consent agreement — same paperwork flow as the join link.
  // Non-fatal. An envelope already out to this person for this event (e.g. they
  // were removed and re-added) is left in flight, not sent twice.
  await dispatchAgreement(db, {
    participantId:     participant.id,
    memberId,
    eventSlug:         registration.event_slug,
    eventTitle:        registration.event_title ?? registration.event_slug,
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
    grade:             participant.grade ?? undefined,
  })

  // Individual payment link (or free-event "no payment required" notice), same
  // as every other way into the group. No-op unless the group pays individually.
  await ensureIndividualPayments(db, registrationId, [{
    participantId: participant.id,
    email:         participant.email,
    firstName:     participant.first_name,
    lastName:      participant.last_name,
  }])

  // Beyond the group's places, the group grows: an unpaid invoice is revised,
  // a paid group is invoiced for the extra place (lib/group-billing.ts).
  const billing = await applyRosterChange(db, stripeClient(), {
    registrationId,
    change: { kind: 'added', count: 1 },
    eventRole: participant.event_role,
    participantIds: [participant.id],
    actor,
  }).catch((err) => {
    console.error(`${logTag} billing update error:`, err)
    return null
  })

  return {
    status: 201,
    body: { participant, billing: { message: billing?.message ?? null, action: billing?.action ?? 'none' } },
    memberId,
  }
}
