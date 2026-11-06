import { NextResponse } from 'next/server'
import type { RegistrationRow } from '@/lib/database.types'
import { normalizeGender, normalizeAgeBracket, normalizeEventRole, normalizeGrade, normalizeTshirt } from '@/lib/member-enums'
import { resolveAndLinkSchool } from '@/lib/school-link'
import { syncMemberOptionSelections } from '@/lib/member-profile-options'
import { mintPayToken } from '@/lib/registration-checkout'
import { shadowSyncFields } from '@/lib/field-crypto-shadow'
import { refuse, temporarilyUnavailable, type Refusable } from '../refusal'
import type { GatedRegistration } from './gate'
import type { IndividualBody } from './parse'

// POST /api/register/individual, the rows: registration, then member, then
// participant. The order, and where each shadowSyncFields falls, are pinned by
// app/api/register/individual/route.characterisation.test.ts.

/** What the writes settled, for the hooks and the response. */
export interface PersistedRegistration {
  regId: string
  payToken: string
  memberId: string | null
  memberIsNew: boolean
  participantId: string
  /** Forced to 'participant' for a minor. */
  resolvedRole: ReturnType<typeof normalizeEventRole>
  /** The linked school's state, when it has one. */
  schoolState: string | null | undefined
}

export type PersistResult = Refusable<{ row: PersistedRegistration }>

export async function persistIndividualRegistration(gated: GatedRegistration, body: IndividualBody): Promise<PersistResult> {
  const { db, email, schoolEmail, dateOfBirth: dob, isMinor, amountDueCents, eventTitle: event_title } = gated
  const {
    event_slug,
    first_name, last_name, nickname, phone,
    grade, gender, ethnicity, t_shirt_size, school_name,
    age_bracket, event_role,
    dietary_requirements, health_conditions,
    emergency_contact_first_name, emergency_contact_last_name,
    emergency_contact_email, emergency_contact_phone,
    emergency_contact_relationship,
    school_address_state,
  } = body

  // Create registration record
  const payToken = mintPayToken()
  const { data: registration, error: regError } = await db
    .from('registrations')
    .insert({
      event_slug,
      event_title,
      type: 'individual',
      status: 'pending',
      amount_due_cents: amountDueCents,
      invoice_requested: false,
      // Pay-later capability — see lib/registration-checkout.ts.
      pay_token: payToken,
      teacher_first_name: null,
      teacher_last_name: null,
      teacher_email: null,
      school_name: null,
      school_address_street: null,
      school_address_city: null,
      school_address_state: null,
      school_address_zip: null,
      withdrawn_at: null,
    })
    .select('id')
    .single()

  if (regError || !registration) {
    console.error('Registration insert error:', regError)
    return refuse(NextResponse.json({ error: 'Failed to create registration' }, { status: 500 }))
  }

  const regId = (registration as Pick<RegistrationRow, 'id'>).id

  // Upsert member record — creates one if this email hasn't registered before.
  // A minor (today or on the event date) is always a high-school participant.
  const resolvedBracket = isMinor ? 'high_school' : normalizeAgeBracket(age_bracket)
  const resolvedRole = isMinor ? 'participant' : normalizeEventRole(event_role)

  // Did THIS request create the member row (vs. one already on file)? Captured
  // before the upsert and used to decide whether a silent sign-in token is
  // safe — never hand an anonymous caller a session for an existing member
  // (deep review C-1). A failed read cannot tell new from existing, so it is a
  // retryable refusal: the registration above is taken back and nothing else
  // is written.
  const priorLookupFailed = async (error: unknown): Promise<PersistResult> => {
    console.error('[register/individual] prior-member lookup failed:', error)
    const { error: takeBackError } = await db.from('registrations').delete().eq('id', regId)
    if (takeBackError) console.error('[register/individual] could not take back registration', regId, takeBackError)
    return refuse(temporarilyUnavailable())
  }
  const { data: priorByEmail, error: priorByEmailError } = await db
    .from('members').select('id').eq('email', email).maybeSingle()
  if (priorByEmailError) return priorLookupFailed(priorByEmailError)
  // The same person under their other address (4 Nov 2026): link to that
  // member rather than create a duplicate. Counts as "not new", so no
  // session is minted and an anonymous caller rewrites nothing (C-1, C-3).
  let priorMember = priorByEmail as { id: string } | null
  if (!priorMember) {
    const { data, error } = await db.from('members').select('id').eq('school_email', email).limit(1).maybeSingle()
    if (error) return priorLookupFailed(error)
    priorMember = (data as { id: string } | null) ?? null
  }
  if (!priorMember && schoolEmail && schoolEmail !== email) {
    const { data, error } = await db.from('members').select('id').eq('email', schoolEmail).maybeSingle()
    if (error) return priorLookupFailed(error)
    priorMember = (data as { id: string } | null) ?? null
  }
  const memberIsNew = !priorMember

  // Only write the canonical members row when this request created it, or when
  // a signed-in member is registering themselves (email is derived from the
  // session above, so sessionMember implies ownership). An anonymous caller
  // naming an existing member's email must NOT rewrite that row — DOB,
  // emergency/guardian contact, role and active flag stay as they were; the
  // submitted details live on the participant/registration row only, for staff
  // to review (deep review C-3, finding REG-2). A brand-new email is created.
  // The upsert keys on email, so a member found only by the other address is
  // linked, never rewritten, even for a signed-in caller.
  const mayWriteMemberRow = memberIsNew || (gated.hasSession && !!priorByEmail)
  let memberId: string | null = priorMember?.id ?? null
  if (mayWriteMemberRow) {
    const { data: memberRow, error: memberUpsertError } = await db
      .from('members')
      .upsert({
        email,
        ...(schoolEmail ? { school_email: schoolEmail } : {}),
        first_name,
        last_name,
        nickname: nickname || null,
        phone,
        date_of_birth: dob,
        gender: normalizeGender(gender),
        grade: normalizeGrade(grade),
        tshirt_size: normalizeTshirt(t_shirt_size),
        age_bracket: resolvedBracket,
        event_role: resolvedRole,
        is_active: true,
        // Persist the profile so the member doesn't re-enter it next time (028).
        // Emergency contact goes to the members table's canonical ec_* columns —
        // the same ones /account, admin, and group-join read (029). Ethnicity and
        // dietary go to the member_ethnicities/member_allergies join tables below
        // for the same reason (030).
        health_conditions: health_conditions || null,
        ec_first_name: emergency_contact_first_name || null,
        ec_last_name: emergency_contact_last_name || null,
        ec_email: emergency_contact_email || null,
        ec_phone: emergency_contact_phone || null,
        ec_relationship: emergency_contact_relationship || null,
      }, { onConflict: 'email', ignoreDuplicates: false })
      .select('id')
      .maybeSingle()
    if (memberUpsertError) {
      console.error('Member upsert error (non-fatal — participant still created):', memberUpsertError)
    }
    memberId = memberRow?.id ?? memberId
    if (memberRow?.id) shadowSyncFields('members', [memberRow.id])
  }

  // Resolve the school to a schools row and link the member to it, so the
  // school surfaces in /admin/schools and on the member page — not just as
  // free text on the participant row. When the registrant picked an existing
  // school, school_id is authoritative (we link to it, never create a dupe);
  // otherwise we resolve-or-create by normalized name. resolvedSchool.state is
  // the canonical state used to fill the DocuSign "State of Residence" tab.
  // Resolve the school either way (its state fills the DocuSign tab), but only
  // LINK it to the member — and only sync the member's ethnicity/dietary join
  // rows — when we were allowed to write that member's row. For an existing
  // member an anonymous caller must not touch, these stay as they were; the
  // participant row below still carries the submitted school and options
  // (deep review C-3, finding REG-2).
  const linkMemberIds = mayWriteMemberRow && memberId ? [memberId] : []
  const resolvedSchool = await resolveAndLinkSchool(db, linkMemberIds, {
    id: body.school_id ?? null,
    name: school_name,
    address_street: body.school_address_street ?? null,
    address_city: body.school_address_city ?? null,
    address_state: school_address_state ?? null,
    address_zip: body.school_address_zip ?? null,
  })
  if (mayWriteMemberRow && memberId) {
    await syncMemberOptionSelections(db, [
      { memberId, ethnicity, dietary: dietary_requirements },
    ])
  }

  // Create participant record
  const { data: partRow, error: partError } = await db.from('participants').insert({
    registration_id: regId,
    member_id: memberId,
    first_name, last_name, nickname: nickname || null,
    email, school_email: schoolEmail, phone, date_of_birth: dob, grade, gender,
    ethnicity: ethnicity ?? [],
    t_shirt_size, school_name, age_bracket,
    event_role: resolvedRole,
    dietary_requirements: dietary_requirements ?? [],
    health_conditions: health_conditions || null,
    emergency_contact_first_name, emergency_contact_last_name,
    emergency_contact_email, emergency_contact_phone,
    emergency_contact_relationship: emergency_contact_relationship || null,
  }).select('id').single()

  if (partError || !partRow) {
    console.error('Participant insert error:', partError)
    await db.from('registrations').delete().eq('id', regId)
    return refuse(NextResponse.json({ error: 'Failed to save participant details' }, { status: 500 }))
  }
  // S4 field encryption: inert unless FIELD_CRYPTO_MODE=shadow; never fails this write.
  shadowSyncFields('participants', [partRow.id])

  return {
    ok: true,
    row: {
      regId,
      payToken,
      memberId,
      memberIsNew,
      participantId: partRow.id,
      resolvedRole,
      schoolState: resolvedSchool?.state,
    },
  }
}
