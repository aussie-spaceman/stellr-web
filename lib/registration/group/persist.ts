import { NextResponse } from 'next/server'
import { isAdultRole } from '@/lib/group-payer'
import { isRegistrationMinor } from '@/lib/registration-eligibility'
import { SCHOOL_DATA_TERMS_VERSION, schoolDataTermsSha256 } from '@/lib/school-data-terms'
import { normalizeGender, normalizeAgeBracket, normalizeGrade, normalizeTshirt, normalizeEmail } from '@/lib/member-enums'
import { mintPayToken } from '@/lib/registration-checkout'
import { shadowSyncFields } from '@/lib/field-crypto-shadow'
import type { RegistrationRow } from '@/lib/database.types'
import { refuse, temporarilyUnavailable, type Refusable } from '../refusal'
import type { GatedGroup } from './gate'
import { enteredPeople, resolveRoleForAge, type GroupBody, type ParticipantPayload } from './parse'

// POST /api/register/group, the rows: the registration, then members, then
// participants. The route runs them in that order with stellr-hooks between the
// members and the participants.
//
// S5 A7: a tenant-age refusal belongs before insertGroupRegistration, in the gate
// beside checkDatesOfBirth (docs/TENANCY-S5.md). route.branches.test.ts pins this path.

export interface SavedRegistration {
  regId: string
  payToken: string | null
}

export async function insertGroupRegistration(
  group: GatedGroup,
  body: GroupBody,
): Promise<Refusable<{ registration: SavedRegistration }>> {
  const { db, teacher, isCampaign, eventTitle, declaredAdultCount, declaredStudentCount } = group
  const { amountDueCents, nothingToCollect } = group.price
  const { event_slug, payment_method, registrant_role, member_pays_individually, details_method } = body
  const poc = body.teacher_poc

  // Create registration record
  const payToken = payment_method === 'card' && !nothingToCollect && !isCampaign ? mintPayToken() : null
  const { data: registration, error: regError } = await db.from('registrations').insert({
    event_slug, event_title: eventTitle,
    // Campaign group registrations are stored as type 'campaign' so they
    // surface in the member's campaign context + workspace (which filter on
    // type='campaign'); regular group event registrations stay type 'group'.
    type: isCampaign ? 'campaign' : 'group',
    // Campaigns and free events are confirmed immediately — nothing will ever
    // be collected, so no webhook will arrive to move them off 'pending'.
    // Paid events stay pending until the Stripe webhook confirms payment.
    status: isCampaign || nothingToCollect ? 'confirmed' : 'pending',
    amount_due_cents: amountDueCents,
    adult_count: declaredAdultCount,
    student_count: declaredStudentCount,
    teacher_first_name: teacher.first_name,
    teacher_last_name: teacher.last_name,
    teacher_email: teacher.email,
    school_name: teacher.school_name,
    school_address_street: teacher.school_address_street,
    school_address_city: teacher.school_address_city,
    school_address_state: teacher.school_address_state,
    school_address_zip: teacher.school_address_zip,
    invoice_requested: payment_method === 'invoice' || payment_method === 'invoice_some',
    // A code the teacher typed, already checked in the gate: the first invoice carries it.
    ...(group.price.discount ? { invoice_coupon_id: group.price.discount.couponId, invoice_promotion_code: group.price.discount.code } : {}),
    // Marks a split group ("Invoice for some") and says how later joiners pay (lib/group-payer.ts).
    late_joiner_payer: payment_method === 'invoice_some' ? (body.late_joiner_payer === 'group' ? 'group' : 'self') : null,
    // "Students share the teacher's cost" (lib/teacher-share.ts): the estimate and a
    // teacher's full price now. The share itself is worked out once the roster exists.
    ...(payment_method === 'teacher_share'
      ? { share_estimate: body.share_estimate ?? null, share_unit_cents: group.price.feeUnitAmount ?? null }
      : {}),
    // Pay-later capability for card payments — see lib/registration-checkout.ts.
    pay_token: payToken,
    registrant_role,
    teacher_poc_first_name: poc?.first_name ?? null,
    teacher_poc_last_name: poc?.last_name ?? null,
    teacher_poc_email: poc?.email ?? null,
    member_pays_individually,
    details_method,
    withdrawn_at: null,
    school_dpa_agreed_at: new Date().toISOString(),
    // Which wording was accepted, so it can be produced later exactly.
    school_data_terms_version: SCHOOL_DATA_TERMS_VERSION,
    school_data_terms_sha256: schoolDataTermsSha256(),
  }).select('id').single()

  if (regError || !registration) {
    console.error('Registration insert error:', regError)
    return refuse(NextResponse.json({ error: 'Failed to create registration' }, { status: 500 }))
  }

  return { ok: true, registration: { regId: (registration as Pick<RegistrationRow, 'id'>).id, payToken } }
}

// deep review REG-11: two distinct students can legitimately share ONE
// guardian email (siblings on a family address), so email alone is not a
// person's identity. Key a person by email + name + DOB and let the FIRST
// distinct person claim that email's member row. A later participant on the
// same email who is a DIFFERENT person is not merged into (or allowed to
// overwrite) that row: members.email is unique, so the sibling cannot get its
// own member row — its details still land on its own participant row,
// and its consent is dispatched per-participant (DS-1 filters coverage on
// minor_name, DS-2 pairs envelopes by row position). Previously this map was
// keyed by email alone, last-wins, which collapsed two siblings into one
// member and linked both participant rows to it.
const personKey = (p: {
  email?: string | null
  first_name?: string | null
  last_name?: string | null
  date_of_birth?: string | null
}) =>
  [
    normalizeEmail(p.email ?? ''),
    (p.first_name ?? '').trim().toLowerCase(),
    (p.last_name ?? '').trim().toLowerCase(),
    p.date_of_birth ?? '',
  ].join('\u0000')

export interface SavedMembers {
  /** Every member this request knows of, by email. Stored, linked or just created. */
  memberIdMap: Record<string, string | null>
  /** email -> personKey of the participant that owns that email's member row. */
  memberEmailOwner: Map<string, string>
  newlyCreatedEmails: Set<string>
  optionsByEmail: Map<string, { ethnicity?: string[]; dietary?: string[] }>
  registrantMemberIsNew: boolean
  registrantMemberId: string | null | undefined
}

export async function saveGroupMembers(
  group: GatedGroup,
  body: GroupBody,
  regId: string,
): Promise<Refusable<{ members: SavedMembers }>> {
  const { db, teacher, eventDate } = group
  const { details_method, registrant_role } = body

  // Upsert all known participants into members table
  const allPeople: ParticipantPayload[] = details_method === 'add_now' ? [
    { ...teacher, event_role: registrant_role === 'student_manager' ? 'school_student_manager' : 'teacher' },
    ...enteredPeople(body),
  ] : [
    { ...teacher, event_role: registrant_role === 'student_manager' ? 'school_student_manager' : 'teacher' },
  ]

  // We still map members by email (the table is unique on email) but remember
  // WHICH person first claimed each email, so a distinct sibling sharing it is
  // skipped rather than overwriting it last-wins.
  const memberUpsertByEmail = new Map<string, Record<string, unknown>>()
  const optionsByEmail = new Map<string, { ethnicity?: string[]; dietary?: string[] }>()
  const linkedMemberIdByEmail = new Map<string, string>()
  // email -> personKey of the participant that owns that email's member row.
  const memberEmailOwner = new Map<string, string>()
  for (const p of allPeople) {
    // Member-ID-linked participants reuse their existing record — never re-upsert
    // (which would overwrite their profile) or re-sync their options. Just keep
    // their id so the participant row links to them.
    if (p._linked_member_id) {
      if (p.email) {
        linkedMemberIdByEmail.set(p.email, p._linked_member_id)
        // They own their email too (REG-11), so a later distinct person on the
        // same email is not collapsed onto their record.
        if (!memberEmailOwner.has(p.email)) memberEmailOwner.set(p.email, personKey(p))
      }
      continue
    }
    // REG-11: a DIFFERENT person already claimed this email in this batch —
    // skip the member upsert for this sibling (no overwrite, no second row on
    // the same unique email). resolveMemberId() leaves their member_id null,
    // so their identity stays on their own participant row.
    const key = personKey(p)
    const owner = memberEmailOwner.get(p.email)
    if (owner && owner !== key) continue
    if (!owner) memberEmailOwner.set(p.email, key)
    const minor = isRegistrationMinor(p.date_of_birth, eventDate)
    optionsByEmail.set(p.email, {
      ethnicity: p.ethnicity,
      dietary: p.dietary_requirements,
    })
    memberUpsertByEmail.set(p.email, {
      email: p.email,
      school_email: p.school_email || null,
      first_name: p.first_name,
      last_name: p.last_name,
      nickname: p.nickname || null,
      phone: p.phone,
      date_of_birth: p.date_of_birth,
      gender: normalizeGender(p.gender),
      grade: normalizeGrade(p.grade),
      tshirt_size: normalizeTshirt(p.t_shirt_size),
      age_bracket: minor ? 'high_school' : normalizeAgeBracket(p.age_bracket),
      event_role: resolveRoleForAge(p.event_role, minor),
      is_active: true,
      // Persist the profile so each member doesn't re-enter it next time (028).
      // Emergency contact goes to the members table's canonical ec_* columns —
      // the same ones /account, admin, and group-join read (029). Ethnicity and
      // dietary go to the member_ethnicities/member_allergies join tables in
      // stellr-hooks for the same reason (030).
      health_conditions: p.health_conditions || null,
      ec_first_name: p.emergency_contact_first_name || null,
      ec_last_name: p.emergency_contact_last_name || null,
      ec_email: p.emergency_contact_email || null,
      ec_phone: p.emergency_contact_phone || null,
      ec_relationship: p.emergency_contact_relationship || null,
    })
  }

  // ── Create new members only; never modify existing ones ────────────────────
  // An existing member must NOT be rewritten from group-registration input: the
  // organiser is not the authority on another person's DOB, emergency/guardian
  // contact, role or active flag, and this is reachable unauthenticated (deep
  // review C-3, finding REG-2). So we split the batch: existing emails are
  // mapped to their current id and left untouched, and only brand-new emails
  // are inserted. The submitted details still land on the participant rows.
  const preexistingMemberEmails = new Set<string>()
  const existingIdByEmail = new Map<string, string>()
  const upsertEmails = [...memberUpsertByEmail.keys()]
  if (upsertEmails.length > 0) {
    const { data: storedMembers, error: storedError } = await db
      .from('members')
      .select('id, email')
      .in('email', upsertEmails)
    if (storedError) {
      // Can't tell new from existing — fail safe by treating every email as
      // pre-existing, so nothing is inserted-over or modified. Participants are
      // still created; their member_id is simply left null.
      console.error('Existing-member preload error (non-fatal):', storedError)
      for (const e of upsertEmails) preexistingMemberEmails.add(e)
    }
    for (const stored of storedMembers ?? []) {
      preexistingMemberEmails.add(stored.email as string)
      existingIdByEmail.set(stored.email as string, stored.id as string)
    }
    // The same person under their other address (4 Nov 2026): a member whose
    // school_email is this address, or whose email is this person's school
    // address, is linked (never rewritten) instead of duplicated.
    const unmatched = upsertEmails.filter((e) => !preexistingMemberEmails.has(e))
    if (!storedError && unmatched.length > 0) {
      const schoolOf = new Map<string, string>()
      for (const e of unmatched) {
        const school = memberUpsertByEmail.get(e)?.school_email as string | null | undefined
        if (school && school !== e) schoolOf.set(school, e)
      }
      const [{ data: bySchoolCol, error: bySchoolColError }, { data: bySchoolAddr, error: bySchoolAddrError }] = await Promise.all([
        db.from('members').select('id, school_email').in('school_email', unmatched),
        schoolOf.size > 0
          ? db.from('members').select('id, email').in('email', [...schoolOf.keys()])
          : Promise.resolve({ data: [] as { id: string; email: string }[], error: null }),
      ])
      // A failed read here cannot tell new from existing, and "new" creates a
      // member and can mint a login. So it is a retryable refusal: the
      // registration is taken back and nothing else is written.
      const schoolLookupError = bySchoolColError ?? bySchoolAddrError
      if (schoolLookupError) {
        console.error('[register/group] school-address lookup failed:', schoolLookupError)
        const { error: takeBackError } = await db.from('registrations').delete().eq('id', regId)
        if (takeBackError) console.error('[register/group] could not take back registration', regId, takeBackError)
        return refuse(temporarilyUnavailable())
      }
      for (const row of (bySchoolCol ?? []) as { id: string; school_email: string }[]) {
        if (preexistingMemberEmails.has(row.school_email)) continue
        preexistingMemberEmails.add(row.school_email)
        existingIdByEmail.set(row.school_email, row.id)
      }
      for (const row of (bySchoolAddr ?? []) as { id: string; email: string }[]) {
        const e = schoolOf.get(row.email)
        if (!e || preexistingMemberEmails.has(e)) continue
        preexistingMemberEmails.add(e)
        existingIdByEmail.set(e, row.id)
      }
    }
  }
  // The registrant is only "new" if their email was in the upsert batch (not
  // already linked/known) and had no row before. If it wasn't in the batch at
  // all we never looked it up, so assume pre-existing and mint no token.
  const registrantMemberIsNew =
    memberUpsertByEmail.has(teacher.email) && !preexistingMemberEmails.has(teacher.email)

  const memberIdMap: Record<string, string | null> = {}
  // Seed linked participants' member ids up front (they were skipped above).
  for (const [email, id] of linkedMemberIdByEmail) memberIdMap[email] = id
  // Map existing members to their current id without writing anything.
  for (const [email, id] of existingIdByEmail) memberIdMap[email] = id

  // Insert only the brand-new members. ignoreDuplicates (INSERT … ON CONFLICT
  // DO NOTHING) means a row that was created in the tiny window since the
  // preload is left as-is, never overwritten.
  const newMemberPayloads = [...memberUpsertByEmail.entries()]
    .filter(([email]) => !preexistingMemberEmails.has(email))
    .map(([, payload]) => payload)
  const newlyCreatedEmails = new Set<string>()
  const { data: memberRows, error: memberUpsertError } = newMemberPayloads.length > 0
    ? await db
        .from('members')
        .upsert(newMemberPayloads, { onConflict: 'email', ignoreDuplicates: true })
        .select('id, email')
    : { data: [], error: null }
  if (memberUpsertError) {
    console.error('Member insert error (non-fatal — participants still created):', memberUpsertError)
  }

  for (const row of memberRows ?? []) {
    memberIdMap[row.email] = row.id
    newlyCreatedEmails.add(row.email as string)
  }

  // Guarantee the registrant's member row when they are NEW. The batched insert
  // above can drop *everyone* if a single row violates an enum/date constraint
  // (ON CONFLICT DO NOTHING handles unique conflicts, not CHECK violations) —
  // and if the new registrant is among the dropped, teacher_member_id never
  // gets set and the Clerk link is skipped, so the organiser lands on a portal
  // that 403s every team action. Re-insert the registrant alone to recover.
  // An EXISTING registrant is already mapped from existingIdByEmail, so this is
  // skipped for them and their row is never touched.
  if (!memberIdMap[teacher.email] && registrantMemberIsNew) {
    const registrantPayload = memberUpsertByEmail.get(teacher.email)
    if (registrantPayload) {
      const { data: soloRow, error: soloErr } = await db
        .from('members')
        .upsert(registrantPayload, { onConflict: 'email', ignoreDuplicates: true })
        .select('id')
        .maybeSingle()
      if (soloErr) console.error('Registrant solo insert error (non-fatal):', soloErr)
      if (soloRow?.id) { memberIdMap[teacher.email] = soloRow.id; newlyCreatedEmails.add(teacher.email) }
    }
  }

  // S4 field encryption (inert unless FIELD_CRYPTO_MODE=shadow): only members
  // this request created; existing rows were not written.
  shadowSyncFields('members', Object.entries(memberIdMap).filter(([e]) => newlyCreatedEmails.has(e)).map(([, id]) => id))

  return {
    ok: true,
    members: {
      memberIdMap,
      memberEmailOwner,
      newlyCreatedEmails,
      optionsByEmail,
      registrantMemberIsNew,
      registrantMemberId: memberIdMap[teacher.email],
    },
  }
}

/** Link registrant's member ID to the registration (enables portal team management). */
export async function linkRegistrantMember(group: GatedGroup, regId: string, members: SavedMembers): Promise<void> {
  if (members.registrantMemberId) {
    await group.db.from('registrations').update({ teacher_member_id: members.registrantMemberId }).eq('id', regId)
  }
}

/** The row saved for one person: what the follow-up and the payment links read. */
export type ParticipantInsert = ReturnType<ReturnType<typeof participantRowBuilder>>

function participantRowBuilder(group: GatedGroup, regId: string, members: SavedMembers) {
  const { teacher, eventDate } = group
  const { memberIdMap, memberEmailOwner } = members

  // deep review REG-11: resolve a participant's member link by PERSON, not by
  // email. Only the participant that first claimed an email owns its member
  // row; a distinct sibling sharing a family email (or a student entered under
  // the teacher's address) resolves to null and keeps its identity on its own
  // participant row, instead of being merged last-wins onto someone else's
  // member. Member-ID-linked participants keep their explicit id.
  const resolveMemberId = (p: ParticipantPayload): string | null => {
    if (p._linked_member_id) return p._linked_member_id
    return memberEmailOwner.get(p.email) === personKey(p)
      ? (memberIdMap[p.email] ?? null)
      : null
  }

  // Build participant rows. event_role is normalised to the enum values the
  // admin roster, Companies auto-assign, and check-in filter on — same
  // under-18 override as the members upsert.
  return (p: ParticipantPayload, paymentStatus?: 'pending' | 'waived' | 'covered' | null, payer?: 'group' | 'self' | 'shared' | null) => ({
    registration_id: regId,
    member_id: resolveMemberId(p),
    details_from_member: !!p._linked_member_id,
    first_name: p.first_name, last_name: p.last_name,
    nickname: p.nickname || null,
    email: p.email, school_email: p.school_email || null, phone: p.phone,
    date_of_birth: p.date_of_birth,
    grade: p.grade ?? null,
    gender: p.gender,
    ethnicity: p.ethnicity ?? [],
    t_shirt_size: p.t_shirt_size,
    school_name: teacher.school_name as string,
    age_bracket: p.age_bracket,
    event_role: resolveRoleForAge(p.event_role, isRegistrationMinor(p.date_of_birth, eventDate)),
    dietary_requirements: p.dietary_requirements ?? [],
    health_conditions: p.health_conditions || null,
    emergency_contact_first_name: p.emergency_contact_first_name || null,
    emergency_contact_last_name: p.emergency_contact_last_name || null,
    emergency_contact_email: p.emergency_contact_email || null,
    emergency_contact_phone: p.emergency_contact_phone || null,
    emergency_contact_relationship: p.emergency_contact_relationship || null,
    individual_payment_status: paymentStatus ?? null,
    payer: payer ?? null,
  })
}

export interface SavedParticipants {
  registrantRow: ParticipantInsert
  /** Every row sent, by position, with the id it came back with. */
  participantsWithId: Array<{ row: ParticipantInsert; participantId: string | undefined }>
}

export async function insertGroupParticipants(
  group: GatedGroup,
  body: GroupBody,
  regId: string,
  members: SavedMembers,
): Promise<Refusable<{ participants: SavedParticipants }>> {
  const { db, teacher } = group
  const { details_method, registrant_role, member_pays_individually, additional_adults, students } = body
  const buildParticipant = participantRowBuilder(group, regId, members)

  // Stamped at insert, independent of whether the notification email later
  // succeeds, so the row carries the right state from the moment it exists:
  // 'pending' is what makes it visible to the Stripe webhook's "has the whole
  // group paid?" check, and 'waived' (free event — no price on the event) is
  // what stops it sitting there owing a payment that can never be made.
  // Previously gated on add_now, which left spreadsheet-method registrants
  // unbilled and silently outside that check.
  const seatPayStatus: 'pending' | 'waived' | null = member_pays_individually
    ? (group.price.canBill ? 'pending' : 'waived')
    : null
  // "Invoice for some": each person is on the invoice or pays by their own link.
  const split = body.payment_method === 'invoice_some'
  const ownLinkStatus: 'pending' | 'waived' = group.price.canBill ? 'pending' : 'waived'
  const payerOf = (onInvoice: boolean | undefined): 'group' | 'self' | null => (split ? (onInvoice ? 'group' : 'self') : null)
  const statusOf = (onInvoice: boolean | undefined) => (split ? (onInvoice ? null : ownLinkStatus) : seatPayStatus)
  // "Students share the teacher's cost": adults are covered, students pay their own way.
  const sharing = body.payment_method === 'teacher_share'
  const shareRow = (row: ParticipantInsert): ParticipantInsert => {
    if (!sharing) return row
    return isAdultRole(row.event_role)
      ? { ...row, payer: 'shared', individual_payment_status: 'covered' }
      : { ...row, payer: 'self' }
  }
  const registrantRow = buildParticipant({
    first_name: teacher.first_name, last_name: teacher.last_name,
    nickname: teacher.nickname,
    email: teacher.email, phone: teacher.phone,
    date_of_birth: teacher.date_of_birth, gender: teacher.gender,
    t_shirt_size: teacher.t_shirt_size, age_bracket: teacher.age_bracket,
    event_role: registrant_role === 'student_manager' ? 'school_student_manager' : 'teacher',
    ethnicity: teacher.ethnicity,
    dietary_requirements: teacher.dietary_requirements,
    health_conditions: teacher.health_conditions,
    grade: teacher.grade ?? undefined,
    emergency_contact_first_name: teacher.emergency_contact_first_name,
    emergency_contact_last_name: teacher.emergency_contact_last_name,
    emergency_contact_email: teacher.emergency_contact_email,
    emergency_contact_phone: teacher.emergency_contact_phone,
    emergency_contact_relationship: teacher.emergency_contact_relationship,
  }, statusOf(body.registrant_on_invoice), payerOf(body.registrant_on_invoice))
  const registrantShared = shareRow(registrantRow)

  const participantRows = [registrantShared]

  if (details_method === 'add_now') {
    for (const a of (additional_adults ?? [])) participantRows.push(shareRow(buildParticipant(a, statusOf(a.on_invoice), payerOf(a.on_invoice))))
    for (const s of (students ?? [])) participantRows.push(shareRow(buildParticipant(s, statusOf(s.on_invoice), payerOf(s.on_invoice))))
  }

  const { data: insertedParts, error: partError } = await db
    .from('participants')
    .insert(participantRows)
    .select('id, email')
  if (partError) {
    console.error('Participant insert error:', partError)
    await db.from('registrations').delete().eq('id', regId)
    return refuse(NextResponse.json({ error: 'Failed to save participant details' }, { status: 500 }))
  }

  // Pair each inserted participant back to its source row by POSITION. A single
  // multi-row INSERT ... RETURNING preserves the VALUES order, so index i lines
  // up. Keying by email (the previous approach) collapsed siblings who share
  // the family email onto ONE participant id — the first child's row then got
  // no agreement and the second was dispatched twice (deep review C-5 / DS-2).
  if ((insertedParts?.length ?? 0) !== participantRows.length) {
    console.error('[register/group] inserted participant count mismatch', {
      inserted: insertedParts?.length ?? 0, expected: participantRows.length,
    })
  }
  // S4 field encryption: inert unless FIELD_CRYPTO_MODE=shadow; never fails this write.
  shadowSyncFields('participants', (insertedParts ?? []).map((p) => p.id as string))

  return {
    ok: true,
    participants: {
      registrantRow,
      participantsWithId: participantRows.map((row, i) => ({
        row,
        participantId: insertedParts?.[i]?.id as string | undefined,
      })),
    },
  }
}
