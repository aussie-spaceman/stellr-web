import type { SupabaseClient } from '@supabase/supabase-js'
import { correctAgreementRecipient, normaliseEmail } from '@/lib/agreement-correction'
import { lookupSuppressions } from '@/lib/email/suppressions'
import { ownsTeam, teamViewerRole, type TeamViewerRole } from '@/lib/team-access'
import { maskEmail } from '@/lib/utils'
import { aboutName, announceCorrection, announceSuggestion, roleLabel } from '@/lib/esign/bounce-notices'
import { hashToken, isWellFormedToken } from '@/lib/esign/email-change-tokens'

// Fixing a bounced signing address without Stellr staff (owner decisions, 9 Nov 2026).
//
//   organiser   the group's registrant (teacher or student manager) or nominated
//               teacher, signed in, in Your group. Only a signer whose email
//               bounced. Refused when the new address is the organiser's own or
//               any student's in the group (a student's own address is allowed
//               on that student's own part of the form). Applied at once; staff,
//               the event manager and the other signer are told.
//   direct      the parent/guardian, through the one-time link in their notice,
//               corrects the student's address. Applied at once.
//   suggestion  the student, through the one-time link, suggests the parent's
//               address. Applied only when the group's organiser (group
//               registration) or an admin/event manager approves.
//
// Every path ends in correctAgreementRecipient: the same form, signatures kept,
// no new DocuSign envelope. Every change is a row in agreement_email_changes.

const LIVE = ['sent', 'delivered']
const STUDENT_EVENT_ROLES = ['participant', 'school_student_manager']
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** Organiser corrections per form per day: a bounce is a rare event, a burst is not. */
const ORGANISER_DAILY_LIMIT = 3

export type ChangeRefusal = { ok: false; status: number; code: string; error: string }
const refuse = (status: number, code: string, error: string): ChangeRefusal => ({ ok: false, status, code, error })

const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase()

interface Registration {
  id: string
  type: string | null
  registrant_role: string | null
  teacher_member_id: string | null
  teacher_email: string | null
  teacher_poc_email: string | null
}

interface LiveAgreement {
  id: string
  status: string | null
  participant_id: string | null
  event_slug: string | null
}

interface Recipient {
  id: string
  recipient_id: string
  role_name: string | null
  name: string | null
  email: string | null
  status: string | null
}

/** True when the address bounced before or was reported as spam: a send to it will fail again. */
async function previouslyBounced(db: SupabaseClient, email: string): Promise<boolean> {
  try {
    const found = await lookupSuppressions(db, [email])
    const reason = found.get(normaliseEmail(email))
    return reason === 'bounce' || reason === 'complaint'
  } catch {
    return false
  }
}

/** The participant's newest agreement, as the Remind route reads it. */
async function newestAgreement(db: SupabaseClient, participantId: string): Promise<LiveAgreement | null> {
  const { data } = await db
    .from('agreements')
    .select('id, status, participant_id, event_slug')
    .eq('participant_id', participantId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as LiveAgreement | null) ?? null
}

async function recipientOf(db: SupabaseClient, agreementId: string, recipientId: string): Promise<Recipient | null> {
  const { data } = await db
    .from('agreement_recipients')
    .select('id, recipient_id, role_name, name, email, status')
    .eq('envelope_row', agreementId)
    .eq('recipient_id', recipientId)
    .maybeSingle()
  return (data as Recipient | null) ?? null
}

/**
 * Why an organiser may not set this address, or null. The address may not be
 * an organiser's own, nor any student's on the registration, except the
 * student's own address on their own part of the form.
 */
export async function organiserAddressProblem(
  db: SupabaseClient,
  input: { registration: Registration; organiserEmails: string[]; participantId: string; roleName: string | null; email: string },
): Promise<ChangeRefusal | null> {
  const email = norm(input.email)
  if (input.organiserEmails.map(norm).includes(email)) {
    return refuse(409, 'OWN_ADDRESS', 'Use the signer’s own address, not yours.')
  }
  const { data } = await db
    .from('participants')
    .select('id, email, school_email, event_role')
    .eq('registration_id', input.registration.id)
  const students = ((data ?? []) as { id: string; email: string | null; school_email: string | null; event_role: string | null }[]).filter((p) =>
    STUDENT_EVENT_ROLES.includes(p.event_role ?? ''),
  )
  const ownPart = input.roleName !== 'Guardian'
  for (const s of students) {
    if (ownPart && s.id === input.participantId) continue
    if (norm(s.email) === email || norm(s.school_email) === email) {
      return refuse(409, 'STUDENT_ADDRESS', 'That address belongs to a student in this group. A parent or guardian needs their own address.')
    }
  }
  return null
}

function validEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = normaliseEmail(raw)
  return EMAIL.test(email) && email.length <= 320 ? email : null
}

async function applyCorrection(
  db: SupabaseClient,
  agreementId: string,
  recipientId: string,
  email: string,
): Promise<{ ok: true } | ChangeRefusal> {
  try {
    const result = await correctAgreementRecipient(db, { agreementId, recipientId, email })
    if (result.kind === 'not_found') return refuse(404, 'NOT_FOUND', 'This form is no longer available.')
    if (result.kind === 'refused') return refuse(result.code === 'INVALID_EMAIL' ? 400 : 409, result.code, result.message)
    return { ok: true }
  } catch (err) {
    console.error('[email-changes] correction failed:', err instanceof Error ? err.message : err)
    return refuse(502, 'ENGINE', 'The signing service did not accept the change. Try again shortly.')
  }
}

export async function supersedeOpenLinks(db: SupabaseClient, agreementId: string, recipientId: string, exceptId?: string): Promise<void> {
  let q = db
    .from('agreement_email_changes')
    .update({ status: 'superseded', updated_at: new Date().toISOString() })
    .eq('agreement_id', agreementId)
    .eq('recipient_id', recipientId)
    .in('status', ['link_sent', 'pending'])
  if (exceptId) q = q.neq('id', exceptId)
  await q
}

// ─── Organisers ───────────────────────────────────────────────────────────

export interface OrganiserMember {
  id: string
  email: string | null
}

type OrganiserAccess = { ok: true; registration: Registration; role: TeamViewerRole; organiserEmails: string[] } | ChangeRefusal

async function organiserAccess(db: SupabaseClient, member: OrganiserMember, registrationId: string): Promise<OrganiserAccess> {
  const { data } = await db
    .from('registrations')
    .select('id, type, registrant_role, teacher_member_id, teacher_email, teacher_poc_email')
    .eq('id', registrationId)
    .eq('type', 'group')
    .maybeSingle()
  const registration = data as Registration | null
  // Someone else's group answers exactly as a group that does not exist, so the
  // route cannot be used to learn which registration ids are real (IDOR suite).
  if (!registration || !ownsTeam(member, registration)) return refuse(404, 'NOT_FOUND', 'Team not found')
  const role = teamViewerRole(member, { ...registration, registrant_role: registration.registrant_role }) ?? 'teacher'
  const organiserEmails = [member.email, registration.teacher_email, registration.teacher_poc_email].filter((e): e is string => !!e)
  return { ok: true, registration, role, organiserEmails }
}

export interface BouncedSignerView {
  recipientId: string
  roleName: string | null
  roleLabel: string
  name: string | null
  email: string | null
}

export interface PendingSuggestionView {
  id: string
  recipientId: string
  roleLabel: string
  oldEmail: string
  newEmail: string
  suggestedBy: string
  sameAsSuggester: boolean
  createdAt: string
}

/** What an organiser sees for one participant: the bounced signers and any suggestion waiting. */
export async function organiserView(
  db: SupabaseClient,
  member: OrganiserMember,
  registrationId: string,
  participantId: string,
): Promise<{ ok: true; agreementId: string | null; bounced: BouncedSignerView[]; pending: PendingSuggestionView[] } | ChangeRefusal> {
  const access = await organiserAccess(db, member, registrationId)
  if (!access.ok) return access
  const { data: p } = await db.from('participants').select('id').eq('id', participantId).eq('registration_id', registrationId).maybeSingle()
  if (!p) return refuse(404, 'NOT_FOUND', 'Participant not found')
  const agreement = await newestAgreement(db, participantId)
  if (!agreement || !LIVE.includes(agreement.status ?? '')) return { ok: true, agreementId: agreement?.id ?? null, bounced: [], pending: [] }
  const { data: rows } = await db
    .from('agreement_recipients')
    .select('id, recipient_id, role_name, name, email, status')
    .eq('envelope_row', agreement.id)
    .order('routing_order', { ascending: true })
  const bounced = ((rows ?? []) as Recipient[])
    .filter((r) => r.status === 'autoresponded' && r.role_name !== 'StellrRepresentative')
    .map((r) => ({ recipientId: r.recipient_id, roleName: r.role_name, roleLabel: roleLabel(r.role_name), name: r.name, email: r.email }))
  return { ok: true, agreementId: agreement.id, bounced, pending: await pendingSuggestions(db, agreement.id) }
}

export async function pendingSuggestions(db: SupabaseClient, agreementId: string): Promise<PendingSuggestionView[]> {
  const { data } = await db
    .from('agreement_email_changes')
    .select('id, recipient_id, role_name, old_email, new_email, requested_by_role, requested_by_email, created_at')
    .eq('agreement_id', agreementId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  return ((data ?? []) as {
    id: string
    recipient_id: string
    role_name: string | null
    old_email: string
    new_email: string | null
    requested_by_role: string | null
    requested_by_email: string | null
    created_at: string
  }[])
    .filter((c) => c.new_email)
    .map((c) => ({
      id: c.id,
      recipientId: c.recipient_id,
      roleLabel: roleLabel(c.role_name),
      oldEmail: c.old_email,
      newEmail: c.new_email as string,
      suggestedBy: roleLabel(c.requested_by_role),
      sameAsSuggester: norm(c.new_email) === norm(c.requested_by_email),
      createdAt: c.created_at,
    }))
}

/** An organiser corrects a bounced signer's address on a participant's form. */
export async function organiserCorrect(
  db: SupabaseClient,
  input: { member: OrganiserMember; registrationId: string; participantId: string; recipientId: string; email: unknown },
): Promise<{ ok: true; email: string } | ChangeRefusal> {
  const access = await organiserAccess(db, input.member, input.registrationId)
  if (!access.ok) return access
  const { data: p } = await db.from('participants').select('id').eq('id', input.participantId).eq('registration_id', input.registrationId).maybeSingle()
  if (!p) return refuse(404, 'NOT_FOUND', 'Participant not found')
  const email = validEmail(input.email)
  if (!email) return refuse(400, 'INVALID_EMAIL', 'Enter a valid email address.')

  const agreement = await newestAgreement(db, input.participantId)
  if (!agreement || !LIVE.includes(agreement.status ?? '')) return refuse(409, 'NOT_LIVE', 'This form is no longer waiting for signatures.')
  const signer = await recipientOf(db, agreement.id, input.recipientId)
  if (!signer) return refuse(404, 'NOT_FOUND', 'Signer not found')
  if (signer.status !== 'autoresponded') {
    return refuse(409, 'NOT_BOUNCED', 'Only an address that bounced can be changed here. Ask Stellr to change a working address.')
  }
  if (norm(signer.email) === email) return refuse(409, 'UNCHANGED', 'That is the address that bounced. Enter a different one.')
  const problem = await organiserAddressProblem(db, {
    registration: access.registration,
    organiserEmails: access.organiserEmails,
    participantId: input.participantId,
    roleName: signer.role_name,
    email,
  })
  if (problem) return problem
  if (await previouslyBounced(db, email)) return refuse(409, 'BOUNCED_BEFORE', 'That address has bounced before. Check it with the family.')

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: recent } = await db
    .from('agreement_email_changes')
    .select('id')
    .eq('agreement_id', agreement.id)
    .eq('kind', 'organiser')
    .gte('created_at', since)
  if ((recent ?? []).length >= ORGANISER_DAILY_LIMIT) {
    return refuse(429, 'TOO_MANY', 'This form’s address has been changed several times today. Contact Stellr to change it again.')
  }

  const applied = await applyCorrection(db, agreement.id, input.recipientId, email)
  if (!applied.ok) return applied
  await db.from('agreement_email_changes').insert({
    agreement_id: agreement.id,
    recipient_id: input.recipientId,
    role_name: signer.role_name,
    kind: 'organiser',
    status: 'applied',
    old_email: norm(signer.email),
    new_email: email,
    requested_by_role: access.role,
    requested_by_member: input.member.id,
    decided_by_member: input.member.id,
    decided_at: new Date().toISOString(),
  })
  await supersedeOpenLinks(db, agreement.id, input.recipientId)
  await announceCorrection(db, {
    agreementId: agreement.id,
    recipientId: input.recipientId,
    oldEmail: signer.email ?? '',
    newEmail: email,
    actor: { kind: 'organiser', memberId: input.member.id, role: access.role },
  })
  return { ok: true, email }
}

/**
 * A roster edit by an organiser that changes a bounced signer's address also
 * fixes the live form, under the same rules as Fix email. Without this the
 * roster showed the new address while the form kept chasing the dead one.
 * Returns a line for the organiser, or null when no bounced signer was affected.
 */
export async function correctFromRosterEdit(
  db: SupabaseClient,
  input: {
    member: OrganiserMember
    registrationId: string
    participantId: string
    before: { email: string | null; emergency_contact_email: string | null }
    after: { email: string | null; emergency_contact_email: string | null }
  },
): Promise<string | null> {
  const changed = {
    guardian: norm(input.before.emergency_contact_email) !== norm(input.after.emergency_contact_email) && norm(input.after.emergency_contact_email),
    own: norm(input.before.email) !== norm(input.after.email) && norm(input.after.email),
  }
  if (!changed.guardian && !changed.own) return null
  const view = await organiserView(db, input.member, input.registrationId, input.participantId)
  if (!view.ok || !view.bounced.length) return null
  const lines: string[] = []
  for (const b of view.bounced) {
    const isGuardian = b.roleName === 'Guardian'
    const newEmail = isGuardian ? changed.guardian : changed.own
    if (!newEmail) continue
    const oldEmail = norm(isGuardian ? input.before.emergency_contact_email : input.before.email)
    if (oldEmail && norm(b.email) !== oldEmail) continue
    const result = await organiserCorrect(db, { ...input, recipientId: b.recipientId, email: newEmail })
    lines.push(
      result.ok
        ? `The ${b.roleLabel}'s consent form was sent again to the new address.`
        : `Saved, but the consent form still has the old ${b.roleLabel} address: ${result.error}`,
    )
  }
  return lines.length ? lines.join(' ') : null
}

// ─── Deciding a suggestion ────────────────────────────────────────────────

interface ChangeRow {
  id: string
  agreement_id: string
  recipient_id: string
  role_name: string | null
  kind: string
  status: string
  old_email: string
  new_email: string | null
  requested_by_email: string | null
}

async function loadPending(db: SupabaseClient, changeId: string): Promise<ChangeRow | null> {
  const { data } = await db
    .from('agreement_email_changes')
    .select('id, agreement_id, recipient_id, role_name, kind, status, old_email, new_email, requested_by_email')
    .eq('id', changeId)
    .maybeSingle()
  const row = data as ChangeRow | null
  return row && row.status === 'pending' && row.kind === 'suggestion' && row.new_email ? row : null
}

async function decide(
  db: SupabaseClient,
  row: ChangeRow,
  decision: 'approve' | 'reject',
  decidedBy: { memberId: string | null; label: string },
): Promise<{ ok: true; decision: 'approve' | 'reject' } | ChangeRefusal> {
  const now = new Date().toISOString()
  // Claim the decision so two approvers clicking at once apply it once.
  const { data: claimed } = await db
    .from('agreement_email_changes')
    .update({
      status: decision === 'approve' ? 'applied' : 'rejected',
      decided_by_member: decidedBy.memberId,
      decided_by_label: decidedBy.label.slice(0, 300),
      decided_at: now,
      updated_at: now,
    })
    .eq('id', row.id)
    .eq('status', 'pending')
    .select('id')
  if (!(claimed ?? []).length) return refuse(409, 'DECIDED', 'This suggestion has already been dealt with.')
  if (decision === 'reject') return { ok: true, decision }

  const applied = await applyCorrection(db, row.agreement_id, row.recipient_id, row.new_email as string)
  if (!applied.ok) {
    await db.from('agreement_email_changes').update({ status: 'pending', decided_by_member: null, decided_by_label: null, decided_at: null, updated_at: now }).eq('id', row.id)
    return applied
  }
  await supersedeOpenLinks(db, row.agreement_id, row.recipient_id, row.id)
  await announceCorrection(db, {
    agreementId: row.agreement_id,
    recipientId: row.recipient_id,
    oldEmail: row.old_email,
    newEmail: row.new_email as string,
    actor: { kind: 'approved', label: `${decidedBy.label}, approving the student’s suggestion` },
  })
  return { ok: true, decision }
}

/** The suggestion is still about the live form's bounced address. */
async function stillApplies(db: SupabaseClient, row: ChangeRow): Promise<LiveAgreement | null> {
  const { data } = await db.from('agreements').select('id, status, participant_id, event_slug').eq('id', row.agreement_id).maybeSingle()
  const agreement = data as LiveAgreement | null
  if (!agreement || !LIVE.includes(agreement.status ?? '')) return null
  const signer = await recipientOf(db, row.agreement_id, row.recipient_id)
  if (!signer || signer.status !== 'autoresponded' || norm(signer.email) !== norm(row.old_email)) return null
  return agreement
}

/** A group organiser approves or rejects a student's suggested parent/guardian address. */
export async function organiserDecide(
  db: SupabaseClient,
  input: { member: OrganiserMember & { name?: string | null }; registrationId: string; changeId: string; decision: unknown },
): Promise<{ ok: true; decision: 'approve' | 'reject' } | ChangeRefusal> {
  // Ids first, then the body: a foreign or missing id is refused the same way
  // whatever the body says (IDOR suite).
  const access = await organiserAccess(db, input.member, input.registrationId)
  if (!access.ok) return access
  const row = await loadPending(db, input.changeId)
  if (!row) return refuse(404, 'NOT_FOUND', 'Suggestion not found')
  const agreement = await stillApplies(db, row)
  // The suggestion must be on a form for a participant in THIS group.
  const { data: p } = agreement?.participant_id
    ? await db.from('participants').select('id').eq('id', agreement.participant_id).eq('registration_id', input.registrationId).maybeSingle()
    : { data: null }
  if (!p) return refuse(404, 'NOT_FOUND', 'Suggestion not found')
  const decision = input.decision === 'approve' || input.decision === 'reject' ? input.decision : null
  if (!decision) return refuse(400, 'BAD_DECISION', 'decision must be approve or reject')
  if (decision === 'approve') {
    const problem = await organiserAddressProblem(db, {
      registration: access.registration,
      organiserEmails: access.organiserEmails,
      participantId: agreement!.participant_id as string,
      roleName: row.role_name,
      email: row.new_email as string,
    })
    if (problem) return problem
    if (await previouslyBounced(db, row.new_email as string)) return refuse(409, 'BOUNCED_BEFORE', 'That address has bounced before. Check it with the family.')
  }
  const label = access.role === 'student_manager' ? "the group's student manager" : "the group's teacher"
  return decide(db, row, decision, { memberId: input.member.id, label })
}

/** An admin or event manager approves or rejects a suggestion (the route checks they may act on the form). */
export async function staffDecide(
  db: SupabaseClient,
  input: { agreementId: string; changeId: string; decision: unknown; memberId: string | null; label: string },
): Promise<{ ok: true; decision: 'approve' | 'reject' } | ChangeRefusal> {
  const decision = input.decision === 'approve' || input.decision === 'reject' ? input.decision : null
  if (!decision) return refuse(400, 'BAD_DECISION', 'decision must be approve or reject')
  const row = await loadPending(db, input.changeId)
  if (!row || row.agreement_id !== input.agreementId) return refuse(404, 'NOT_FOUND', 'Suggestion not found')
  if (!(await stillApplies(db, row))) {
    await db.from('agreement_email_changes').update({ status: 'superseded', updated_at: new Date().toISOString() }).eq('id', row.id)
    return refuse(409, 'STALE', 'The address has already been changed, or the form is no longer live.')
  }
  return decide(db, row, decision, { memberId: input.memberId, label: input.label })
}

// ─── One-time links ───────────────────────────────────────────────────────

export interface LinkView {
  kind: 'direct' | 'suggestion'
  /** First name of the person the form is about. */
  aboutFirstName: string
  eventTitle: string
  roleLabel: string
  maskedOldEmail: string
  expiresAt: string
}

interface LinkRow extends ChangeRow {
  token_expires_at: string | null
  used_at: string | null
  requested_by_role: string | null
}

async function liveLink(db: SupabaseClient, token: unknown, now: Date): Promise<{ row: LinkRow; agreement: { minor_name: string | null; signer_name: string | null; event_title: string | null } } | null> {
  if (!isWellFormedToken(token)) return null
  const { data } = await db
    .from('agreement_email_changes')
    .select('id, agreement_id, recipient_id, role_name, kind, status, old_email, new_email, requested_by_email, requested_by_role, token_expires_at, used_at')
    .eq('token_hash', hashToken(token))
    .maybeSingle()
  const row = data as LinkRow | null
  if (!row || row.status !== 'link_sent' || row.used_at || (row.kind !== 'direct' && row.kind !== 'suggestion')) return null
  if (!row.token_expires_at || new Date(row.token_expires_at).getTime() <= now.getTime()) return null
  if (!(await stillApplies(db, row))) return null
  const { data: a } = await db.from('agreements').select('minor_name, signer_name, event_title').eq('id', row.agreement_id).maybeSingle()
  if (!a) return null
  return { row, agreement: a as { minor_name: string | null; signer_name: string | null; event_title: string | null } }
}

/** What the link page shows; null for any link that no longer works (one answer for every reason). */
export async function viewLink(db: SupabaseClient, token: unknown, now: Date = new Date()): Promise<LinkView | null> {
  const live = await liveLink(db, token, now)
  if (!live) return null
  return {
    kind: live.row.kind as 'direct' | 'suggestion',
    aboutFirstName: aboutName(live.agreement).split(/\s+/)[0],
    eventTitle: live.agreement.event_title?.trim() || 'the event',
    roleLabel: roleLabel(live.row.role_name),
    maskedOldEmail: maskEmail(live.row.old_email),
    expiresAt: live.row.token_expires_at as string,
  }
}

const DEAD_LINK = refuse(410, 'LINK', 'This link has expired or has already been used.')

/** Uses a one-time link: a parent's correction is applied; a student's suggestion waits for an adult. */
export async function submitLink(
  db: SupabaseClient,
  input: { token: unknown; email: unknown; now?: Date },
): Promise<{ ok: true; outcome: 'applied' | 'pending' } | ChangeRefusal> {
  const now = input.now ?? new Date()
  const live = await liveLink(db, input.token, now)
  if (!live) return DEAD_LINK
  const { row } = live
  const email = validEmail(input.email)
  if (!email) return refuse(400, 'INVALID_EMAIL', 'Enter a valid email address.')
  if (email === norm(row.old_email)) return refuse(409, 'UNCHANGED', 'That is the address that bounced. Enter a different one.')
  if (row.kind === 'direct' && email === norm(row.requested_by_email)) {
    return refuse(409, 'OWN_ADDRESS', 'Enter the student’s own address. Their part of the form must come to them.')
  }
  if (await previouslyBounced(db, email)) return refuse(409, 'BOUNCED_BEFORE', 'That address has bounced before. Check it and try another.')

  // Spend the link: one use, whoever gets here first.
  const { data: spent } = await db
    .from('agreement_email_changes')
    .update({ used_at: now.toISOString(), new_email: email, status: row.kind === 'direct' ? 'applied' : 'pending', updated_at: now.toISOString() })
    .eq('id', row.id)
    .is('used_at', null)
    .eq('status', 'link_sent')
    .select('id')
  if (!(spent ?? []).length) return DEAD_LINK

  if (row.kind === 'suggestion') {
    await supersedeOpenLinks(db, row.agreement_id, row.recipient_id, row.id)
    await announceSuggestion(db, { agreementId: row.agreement_id, suggested: email })
    return { ok: true, outcome: 'pending' }
  }

  const applied = await applyCorrection(db, row.agreement_id, row.recipient_id, email)
  if (!applied.ok) {
    // Give the link back so the parent can try again once the service recovers.
    await db.from('agreement_email_changes').update({ used_at: null, new_email: null, status: 'link_sent', updated_at: now.toISOString() }).eq('id', row.id)
    return applied
  }
  await db.from('agreement_email_changes').update({ decided_at: now.toISOString(), decided_by_label: 'parent/guardian on the form' }).eq('id', row.id)
  await supersedeOpenLinks(db, row.agreement_id, row.recipient_id, row.id)
  await announceCorrection(db, { agreementId: row.agreement_id, recipientId: row.recipient_id, oldEmail: row.old_email, newEmail: email, actor: { kind: 'guardian' } })
  return { ok: true, outcome: 'applied' }
}
