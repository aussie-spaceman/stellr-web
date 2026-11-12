import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { sendEmail, studentLeftTeamEmail } from '@/lib/email'
import { resolveEmailPair } from '@/lib/member-email'
import { normalizeEventRole } from '@/lib/member-enums'
import { ownsTeam } from '@/lib/team-access'
import { assertNotImpersonating } from '@/lib/impersonation'
import { shadowSyncFields } from '@/lib/field-crypto-shadow'
import { removeEventParticipation } from '@/lib/event-participation-sync'
import { stripeClient } from '@/lib/stripe'
import { executeRefund, type RefundResult } from '@/lib/refunds/execute'
import { applyRosterChange, describeRemoval } from '@/lib/group-billing'
import { isRegistrationMinor } from '@/lib/registration-eligibility'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { DETAILS_MEMBER_MANAGED, isDetailsHiddenFrom } from '@/lib/team-linked-details'
import { correctFromRosterEdit } from '@/lib/esign/email-changes'
import { withAudit } from '@/lib/audit/route'
import { requestTenant } from '@/lib/tenancy/request-tenant'
import { rowTenant } from '@/lib/registration/event-context'
import { assertRegistrable } from '@/lib/registration/eligibility'
import {
  isEligibilityRefusal,
  resolveRosterContext,
  rosterPaymentsRefusal,
  rosterRefusal,
  rosterTakesMoney,
  TENANT_MONEY_COLUMNS,
  withoutTenantId,
} from '@/lib/registration/roster-context'
import { teamAudit, TEAM_PARTICIPANT_REMOVE_AUDIT, TEAM_PARTICIPANT_UPDATE_AUDIT } from '@/lib/registration/team-audit'

// A roster change waits out the group invoice quiet period after responding
// (lib/group-billing.ts), and that wait has to fit inside the function.
export const maxDuration = 300

// S5 A8. Both handlers act only on a group of this host's tenant (Stellr on Stellr's
// hosts): another tenant's group answers as missing. Both are audited behind
// PLATFORM_AUDIT_ENABLED, on the group's tenant's chain, with the registration as the
// target; who was edited or removed stays out of the event.
//
// An edit never writes tenant_id or registration_id (neither is in `allowed`). An
// edited date of birth goes through assertRegistrable with the group's context: for
// Stellr's group exactly today's check, for another tenant's that tenant's rules and
// no minor. If the database's eligibility check still refuses it, the answer says so
// rather than reporting a failed save.

/** The answer a team route gives for a group of another tenant: the missing group's. */
const teamNotFound = () => NextResponse.json({ error: 'Team not found' }, { status: 404 })

// PATCH /api/members/teams/[id]/participants/[pid]
export const PATCH = withAudit(TEAM_PARTICIPANT_UPDATE_AUDIT, updateParticipant)

async function updateParticipant(
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
      .select('id, teacher_member_id, teacher_email, teacher_poc_email, event_slug, tenant_id')
      .eq('id', registrationId)
      .eq('type', 'group')
      .maybeSingle(),
  ])

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (!registration) return NextResponse.json({ error: 'Team not found' }, { status: 404 })
  if (rowTenant(registration.tenant_id) !== (await requestTenant()).tenantId) return teamNotFound()

  // Only an owner of this registration can edit participants — the registrant
  // (teacher or student manager) or the nominated teacher POC (see lib/team-access).
  if (!ownsTeam(member, registration)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  teamAudit(req, { registrationId, tenantId: rowTenant(registration.tenant_id), userId })

  const { data: target } = await db
    .from('participants')
    .select('member_id, details_from_member, email, emergency_contact_email')
    .eq('id', pid)
    .eq('registration_id', registrationId)
    .maybeSingle()
  if (target && isDetailsHiddenFrom(target, member.id)) {
    return NextResponse.json(DETAILS_MEMBER_MANAGED, { status: 409 })
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
  // Personal takes primacy: with only a school address, it is the primary.
  if ('email' in body || 'school_email' in body) {
    const emails = resolveEmailPair({ email: body.email, school_email: body.school_email })
    if ('email' in body) {
      if (!emails.email) return NextResponse.json({ error: 'Enter an email address.' }, { status: 400 })
      updates.email = emails.email
    }
    updates.school_email = emails.school_email
  }

  // S0 (2 Nov 2026): an edited date of birth gets the same check as one added
  // (POST, and the registration routes): a cleared, unreadable or future date
  // is refused, not stored for the agreement and consent rules to misread.
  // S5 A8: through assertRegistrable with the group's context (no read for Stellr's).
  const tenantGroup = rowTenant(registration.tenant_id) !== STELLR_TENANT_ID
  if ('date_of_birth' in updates) {
    const roster = await resolveRosterContext(db, registration, 'teams/participants/pid')
    if (!roster.ok) {
      const refused = rosterRefusal(roster)
      return NextResponse.json(refused.body, { status: refused.status })
    }
    const ageCheck = assertRegistrable(updates.date_of_birth, roster.eligibility, {
      name: [body.first_name, body.last_name].filter(Boolean).join(' ').trim() || 'this person',
    })
    if (!ageCheck.ok) {
      return NextResponse.json({ code: ageCheck.reason, error: ageCheck.error }, { status: ageCheck.reason === 'eligibility_unavailable' ? 503 : 400 })
    }
    updates.date_of_birth = ageCheck.dateOfBirth
  }

  // A minor takes part as a student (the registration routes' rule): an edit
  // can neither give a minor an adult role or bracket nor keep one after their
  // date of birth is corrected. The date being saved decides; without one in
  // the edit, the one on the row does, and a missing or unreadable one counts
  // as a minor.
  if ('date_of_birth' in updates || 'event_role' in updates || 'age_bracket' in updates) {
    const { data: current } = await db
      .from('participants')
      .select('date_of_birth, event_role')
      .eq('id', pid)
      .eq('registration_id', registrationId)
      .maybeSingle()
    const row = current as { date_of_birth: string | null; event_role: string | null } | null
    const dob = 'date_of_birth' in updates ? updates.date_of_birth : row?.date_of_birth ?? null
    if (isRegistrationMinor(dob)) {
      const role = 'event_role' in updates ? updates.event_role : row?.event_role
      updates.event_role = role === 'school_student_manager' ? role : 'participant'
      updates.age_bracket = 'high_school'
    }
  }

  const { data: participant, error } = await db
    .from('participants')
    .update(updates)
    .eq('id', pid)
    .eq('registration_id', registrationId)
    .select()
    .single()

  if (error) {
    // S5 A8: on another tenant's group, the database's eligibility check refusing the
    // date answers as the eligibility check does. Stellr's answer is unchanged.
    if (tenantGroup && isEligibilityRefusal(error)) {
      console.warn('[teams/participants/pid] the participants eligibility check refused an edit')
      const refused = rosterRefusal({ ok: false, reason: 'rules_unavailable', detail: 'tenant_mismatch' })
      return NextResponse.json(refused.body, { status: refused.status })
    }
    // The code and message only: a check or unique violation's details carry the row.
    console.error('[teams/participants/pid] Update error:', (error as { code?: string }).code, error.message)
    return NextResponse.json({ error: 'Failed to update participant' }, { status: 500 })
  }
  // S4 field encryption: inert unless FIELD_CRYPTO_MODE=shadow; never fails this write.
  shadowSyncFields('participants', [pid])

  // A bounced signer's address edited here also fixes the live consent form.
  let consentMessage: string | null = null
  // Stellr's consent forms only: another tenant's group has none of them.
  if (!tenantGroup && target && ('email' in updates || 'emergency_contact_email' in updates)) {
    const before = target as { email: string | null; emergency_contact_email: string | null }
    const after = participant as { email: string | null; emergency_contact_email: string | null }
    consentMessage = await correctFromRosterEdit(db, {
      member,
      registrationId,
      participantId: pid,
      before: { email: before.email, emergency_contact_email: before.emergency_contact_email },
      after: { email: after.email, emergency_contact_email: after.emergency_contact_email },
    }).catch((err) => {
      console.error('[teams/participants/pid] consent form correction failed:', err)
      return null
    })
  }

  return NextResponse.json({ participant: withoutTenantId(participant as Record<string, unknown>), consent: consentMessage ? { message: consentMessage } : undefined })
}

// DELETE /api/members/teams/[id]/participants/[pid]
// Teacher can remove any participant; student can only remove themselves.
export const DELETE = withAudit(TEAM_PARTICIPANT_REMOVE_AUDIT, removeParticipant)

async function removeParticipant(
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
      .select(`id, teacher_member_id, teacher_first_name, teacher_email, teacher_poc_email, event_title, event_slug, tenant_id, ${TENANT_MONEY_COLUMNS}`)
      .eq('id', registrationId)
      .maybeSingle(),
  ])

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (!participant) return NextResponse.json({ error: 'Participant not found' }, { status: 404 })
  if (!registration) return NextResponse.json({ error: 'Team not found' }, { status: 404 })
  // S5 A8: another tenant's group answers as a missing participant, before anything
  // about it, or about whether the caller may act on it, is told.
  if (rowTenant(registration.tenant_id) !== (await requestTenant()).tenantId) {
    return NextResponse.json({ error: 'Participant not found' }, { status: 404 })
  }
  const tenantGroup = rowTenant(registration.tenant_id) !== STELLR_TENANT_ID

  // An owner (registrant — teacher or student manager — or teacher POC) can remove
  // anyone; a participant can only remove themselves.
  const isManager = ownsTeam(member, registration)
  const isSelf = participant.member_id === member.id

  if (!isManager && !isSelf) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  teamAudit(req, { registrationId, tenantId: rowTenant(registration.tenant_id), userId })
  // S5 A8: nothing is refunded or re-billed for another tenant until S9. A group of
  // theirs that shows any sign of money is refused here, before the refund reads
  // Stripe; any other is removed with no Stripe call at all.
  if (tenantGroup && rosterTakesMoney(registration)) {
    const refused = rosterPaymentsRefusal()
    return NextResponse.json(refused.body, { status: refused.status })
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

  // A place that was paid for is refunded BEFORE the row goes (the refund reads
  // the participant's payment). It follows the 45-day money-back guarantee and
  // goes to whoever paid: the organiser for a group payment, the student for a
  // seat they paid themselves. executeRefund never throws on a Stripe failure.
  let refund: RefundResult | null = null
  try {
    if (!tenantGroup) {
      refund = await executeRefund(pid, 'cash', member.id, isManager ? 'Removed by the group organiser' : 'Left the team', { actorType: 'member' })
    }
  } catch (err) {
    console.error('[teams/participants/pid] refund error:', err)
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

  // The group now has one fewer place: an unpaid invoice is revised and
  // re-sent (lib/group-billing.ts). Never throws; a failure alerts staff.
  const billing = tenantGroup ? null : await applyRosterChange(db, stripeClient(), {
    registrationId,
    change: { kind: 'removed' },
    eventRole: participant.event_role,
    participantIds: [pid],
    actor: { memberId: member.id, label: isManager ? 'organiser' : 'participant' },
  }).catch((err) => {
    console.error('[teams/participants/pid] billing update error:', err)
    return null
  })

  // deep review REG-10: removing the participant row alone leaves the member in
  // the event's community Space (which may be full of minors), and the next
  // registration for the event re-grants it from the cohort roster. Revoke the
  // inherited Space access now. No-ops if this member still holds another active
  // participant on the event (the row is already deleted, so the guard is clean).
  // S5 A8: on any tenant's group. A8's tenant rows carry no member_id, but a row
  // written before A8 may, and whatever it was granted is revoked with it.
  if (participant.member_id && registration.event_slug) {
    await removeEventParticipation(db, {
      memberId: participant.member_id,
      eventSlug: registration.event_slug,
    })
  }

  // Notify the organiser if a participant removed themselves
  // Sent as Stellr, so Stellr's groups only.
  if (!tenantGroup && isSelf && !isManager && registration.teacher_email && registration.teacher_first_name) {
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

  return NextResponse.json({
    success: true,
    billing: { message: describeRemoval(refund, billing), action: billing?.action ?? 'none', seats: billing?.seatsAfter ?? null },
  })
}
