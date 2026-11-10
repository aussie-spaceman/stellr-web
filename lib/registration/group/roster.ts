import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { assertRegistrable, type EligibilityContext } from '../eligibility'
import { isValidEmail } from '@/lib/member-enums'
import { getMemberOnFileByMembershipId } from '@/lib/member-onfile'
import { confirmsMemberLastName, memberIdUnusableMessage } from '@/lib/membership-id'
import { ageRefused, eligibilityRefused } from '../refusal'
import { enteredPeople, type GroupBody, type ParticipantPayload, type TeacherPayload } from './parse'

// POST /api/register/group, the people named in the body: Member ID slots, typed
// addresses and dates of birth. Reads only. All of this edits the people in the
// body, so the writes that follow see what was settled here.

/** The name each linked slot came in with: all its sheet row carries. */
export type LinkedSlotNames = Map<ParticipantPayload, { first_name: string; last_name: string }>

/**
 * Resolve any member-ID-linked participants to their on-file record. The
 * organiser only typed a Member ID + "Accept", so the rest of the slot is
 * blank — fill it from the member's stored profile and stamp the resolved
 * member id so the email-keyed upsert in persist skips them (the member is reused,
 * never overwritten — the real fix for the silent overwrite/duplicate bug).
 *
 * What a slot gets back does not depend on the record an ID names. The form
 * always sends the last name the lookup confirmed (MemberIdLookup), so the ID
 * counts only with that name, as /api/members/lookup requires, and only when the
 * record has a usable date of birth. Otherwise the slot is what was submitted,
 * the same for an unknown ID, a wrong name and an unusable record.
 *
 * S5 A7: the record must pass assertRegistrable with the event's own context, the
 * same check checkDatesOfBirth makes, so a record under the event's minimum age is
 * an unusable ID like any other. For Stellr's events that is today's check.
 *
 * On a tenant's event every Member ID slot is unusable, with that same answer, and
 * nothing is read: Member IDs are Stellr's, held on the member record every
 * organiser shares, so neither the lookup nor the profile it fills the slot from
 * may reach across to a tenant. The organiser types the person in instead.
 */
export async function resolveLinkedSlots(
  db: SupabaseClient,
  people: ParticipantPayload[] | null | undefined,
  eligibility: EligibilityContext,
  linkedSlotNames: LinkedSlotNames,
  unusedMemberIds: Set<ParticipantPayload>,
): Promise<void> {
  for (const p of people ?? []) {
    if (!p.linked || !p.existing_membership_id) continue
    if (!eligibility.isPlatformOwner) {
      p.linked = false
      unusedMemberIds.add(p)
      continue
    }
    const onFile = await getMemberOnFileByMembershipId(db, p.existing_membership_id)
    if (
      !onFile ||
      !confirmsMemberLastName(p.last_name, onFile) ||
      !assertRegistrable(onFile.date_of_birth, eligibility).ok
    ) {
      p.linked = false
      unusedMemberIds.add(p)
      continue
    }
    linkedSlotNames.set(p, { first_name: p.first_name ?? '', last_name: p.last_name ?? '' })
    p.first_name = onFile.first_name
    p.last_name = onFile.last_name
    p.nickname = onFile.nickname ?? undefined
    p.email = onFile.email
    p.phone = onFile.phone ?? ''
    p.date_of_birth = onFile.date_of_birth ?? ''
    p.grade = onFile.grade ?? undefined
    p.gender = onFile.gender ?? ''
    p.t_shirt_size = onFile.t_shirt_size ?? ''
    p.ethnicity = onFile.ethnicity
    p.dietary_requirements = onFile.dietary_requirements
    p.health_conditions = onFile.health_conditions ?? undefined
    p.emergency_contact_first_name = onFile.emergency_contact_first_name ?? undefined
    p.emergency_contact_last_name = onFile.emergency_contact_last_name ?? undefined
    p.emergency_contact_email = onFile.emergency_contact_email ?? undefined
    p.emergency_contact_phone = onFile.emergency_contact_phone ?? undefined
    p.emergency_contact_relationship = onFile.emergency_contact_relationship ?? undefined
    p._linked_member_id = onFile.memberId
  }
}

/**
 * Every address typed on the form must be a real-looking email. The form
 * only checked "not blank", so a guardian entered as "none" or "…@gmailcom"
 * reached DocuSign, which refused that student's envelope outright. Only a
 * slot that resolved to a member skips this: its details are the stored
 * record's. A slot whose Member ID could not be used is typed like any other.
 */
export function refuseBadEmails(body: Pick<GroupBody, 'additional_adults' | 'students'>): Response | null {
  const badEmail = (p: ParticipantPayload, field: 'email' | 'emergency_contact_email') =>
    !p._linked_member_id && !!p[field]?.trim() && !isValidEmail(p[field])
  const describe = (p: ParticipantPayload) =>
    [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || 'one person'
  for (const p of enteredPeople(body)) {
    if (badEmail(p, 'email')) {
      return NextResponse.json(
        { error: `The email for ${describe(p)} doesn't look right. Please check it and try again.` },
        { status: 400 },
      )
    }
  }
  for (const s of body.students ?? []) {
    if (badEmail(s, 'emergency_contact_email')) {
      return NextResponse.json(
        { error: `The parent or guardian email for ${describe(s)} doesn't look right. Their consent form is sent there, so please check it and try again.` },
        { status: 400 },
      )
    }
  }
  return null
}

/**
 * S0 (2 Nov 2026): every person this request writes needs a real past date
 * of birth — the registrant always, and with add_now everyone entered —
 * checked before anything is written. Age is taken on the event's start date.
 * A Member ID that could not be used needs one typed in, like anyone else: a
 * participant row cannot be saved without it.
 *
 * S5 A7: this loop is the one place every person a participant row will be written
 * for passes through before the first write (route.branches.test.ts pins that), so
 * the event's eligibility rules are asserted here, over everyone, through
 * assertRegistrable: for Stellr's events exactly the check above, and for a tenant's,
 * its minimum age and no one under 18. resolveLinkedSlots makes the same check with the same context, so
 * a record that fails it takes the unused ID path and gets the one answer below.
 */
export function checkDatesOfBirth(
  teacher: TeacherPayload,
  body: Pick<GroupBody, 'details_method' | 'additional_adults' | 'students'>,
  eligibility: EligibilityContext,
  unusedMemberIds: Set<ParticipantPayload>,
): Response | null {
  const peopleToCheck: Array<{ p: ParticipantPayload; isRegistrant: boolean }> = [
    { p: teacher as ParticipantPayload, isRegistrant: true },
    ...(body.details_method === 'add_now'
      ? enteredPeople(body).map((p) => ({ p, isRegistrant: false }))
      : []),
  ]
  for (const { p, isRegistrant } of peopleToCheck) {
    const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || 'one person'
    const check = assertRegistrable(p.date_of_birth, eligibility, isRegistrant ? {} : { name })
    if (!check.ok) {
      return unusedMemberIds.has(p) && check.reason === 'dob_missing'
        ? ageRefused({ reason: check.reason, error: memberIdUnusableMessage(name) })
        : eligibilityRefused(check)
    }
    p.date_of_birth = check.dateOfBirth
  }
  return null
}
