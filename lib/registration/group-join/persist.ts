import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { shadowSyncFields } from '@/lib/field-crypto-shadow'
import { refuse, temporarilyUnavailable, type Refusable } from '../refusal'
import type { ConfirmedJoinLink } from './gate'
import type { GroupJoiner } from './identify'

// POST /api/register/group-join, the participant row: is there still a place for
// this person, then the insert. The order, and where shadowSyncFields falls, are
// pinned by app/api/register/group-join/route.characterisation.test.ts.

export async function persistGroupJoin(
  db: SupabaseClient,
  link: ConfirmedJoinLink,
  joiner: GroupJoiner,
): Promise<Refusable<{ participantId: string }>> {
  const { reg, registrationId, schoolName, memberPaysIndividually } = link
  const { person, memberId } = joiner

  // Already in this registration?
  // deep review REG-7: fail CLOSED on a lookup error. A discarded error read as
  // "not present" and let a duplicate participant through; a transient 5xx must
  // not add a second row (two consent envelopes, two Space grants, double
  // payment). The unique index participants_reg_email_uniq is the real guard
  // against the read-then-insert race (handled at the insert below); this just
  // stops silently proceeding when the pre-check itself fails.
  const { data: existing, error: existingError } = await db
    .from('participants')
    .select('id')
    .eq('registration_id', registrationId)
    .eq('email', person.email)
    .maybeSingle()
  if (existingError) {
    console.error('[register/group-join] dedupe lookup failed:', existingError)
    return refuse(temporarilyUnavailable())
  }

  if (existing) {
    return refuse(NextResponse.json({ error: 'You are already registered in this group.' }, { status: 409 }))
  }

  // The same person can be on the roster under their other address: an organiser
  // may have added them by their school address, and they sign in with their
  // primary. Matched on the address, not member_id, which a roster row can hold for
  // someone else when a submitted school address belongs to another member.
  if (person.school_email && person.school_email !== person.email) {
    const { data: otherAddress, error: otherAddressError } = await db
      .from('participants')
      .select('id')
      .eq('registration_id', registrationId)
      .eq('email', person.school_email)
      .maybeSingle()
    if (otherAddressError) {
      console.error('[register/group-join] school address dedupe lookup failed:', otherAddressError)
      return refuse(temporarilyUnavailable())
    }
    if (otherAddress) {
      return refuse(NextResponse.json({ error: 'You are already registered in this group.' }, { status: 409 }))
    }
  }

  // Cap at the declared group size. Once every place the organiser nominated is
  // filled, the link stops accepting NEW people (the dedupe above still lets an
  // already-registered member re-open the link harmlessly). Registrations created
  // before migration 037 have null counts → no cap, preserving old behaviour.
  const declaredAdults = reg.adult_count as number | null
  const declaredStudents = reg.student_count as number | null
  if (declaredAdults != null && declaredStudents != null) {
    const { count: currentCount, error: countError } = await db
      .from('participants')
      .select('*', { count: 'exact', head: true })
      .eq('registration_id', registrationId)
    // deep review REG-7: fail CLOSED on a count error rather than admitting
    // past the declared cap because the count could not be read.
    if (countError) {
      console.error('[register/group-join] capacity count failed:', countError)
      return refuse(temporarilyUnavailable())
    }
    if ((currentCount ?? 0) >= declaredAdults + declaredStudents) {
      return refuse(NextResponse.json({
        error: 'This group is already full — every place the organiser registered has been filled. Please contact your organiser if you think this is a mistake.',
      }, { status: 409 }))
    }
  }

  const paymentStatus = memberPaysIndividually ? 'pending' : null

  // Insert participant row
  const { data: partRow, error: partError } = await db.from('participants').insert({
    registration_id: registrationId,
    // S5 A7: from the resolved event, Stellr's included.
    tenant_id: link.context.tenantId,
    member_id: memberId,
    first_name: person.first_name,
    last_name: person.last_name,
    nickname: null,
    email: person.email,
    school_email: person.school_email ?? null,
    phone: person.phone ?? '',
    date_of_birth: person.date_of_birth,
    grade: person.grade ?? null,
    gender: person.gender,
    ethnicity: [],
    t_shirt_size: person.t_shirt_size ?? '',
    school_name: schoolName,
    age_bracket: person.age_bracket,
    event_role: person.event_role,
    dietary_requirements: person.dietary_requirements,
    health_conditions: person.health_conditions,
    emergency_contact_first_name: person.ec_first_name,
    emergency_contact_last_name: person.ec_last_name,
    emergency_contact_email: person.ec_email,
    emergency_contact_phone: person.ec_phone,
    emergency_contact_relationship: person.ec_relationship,
    individual_payment_status: paymentStatus,
    join_completed_at: new Date().toISOString(),
  }).select('id').single()

  if (partError || !partRow) {
    // deep review REG-7: the unique index participants_reg_email_uniq closes the
    // read-then-insert race — two concurrent joins on the same token both pass
    // the dedupe read above, but only one insert can win. The loser hits a
    // unique violation (23505); that is "already registered" (409), not a 500.
    if (partError?.code === '23505') {
      return refuse(NextResponse.json({ error: 'You are already registered in this group.' }, { status: 409 }))
    }
    console.error('Group join participant insert error:', partError)
    return refuse(NextResponse.json({ error: 'Failed to complete registration. Please try again.' }, { status: 500 }))
  }
  // S4 field encryption: inert unless FIELD_CRYPTO_MODE=shadow; never fails this write.
  shadowSyncFields('participants', [partRow.id as string])

  return { ok: true, participantId: partRow.id as string }
}
