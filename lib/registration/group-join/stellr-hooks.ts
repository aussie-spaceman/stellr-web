import type { SupabaseClient } from '@supabase/supabase-js'
import { dispatchAgreement } from '@/lib/docusign-agreements'
import { recordEventParticipation } from '@/lib/event-participation-sync'
import { linkMembersToSchoolByName } from '@/lib/school-link'
import { syncObjectSpaceRoster, reconcileEventSpaceRoster } from '@/lib/space-inheritance'
import type { GroupJoinLink } from './gate'
import type { GroupJoiner } from './identify'

/**
 * POST /api/register/group-join, what follows the row: the school, event activity,
 * the event's Spaces and the agreement. Run in this order on every join today.
 *
 * Not everything here is Stellr-only: a tenant event can have minors, and the
 * agreement is their consent. Do not gate the whole of this on the platform owner.
 */
export async function runGroupJoinHooks(
  db: SupabaseClient,
  link: GroupJoinLink,
  joiner: GroupJoiner,
  participantId: string,
): Promise<void> {
  const { reg, registrationId, eventSlug, eventTitle, schoolName } = link
  const { person, memberId } = joiner

  // Link the joining member to the group's school so it surfaces in
  // /admin/schools and on their member page — not just as participant text.
  // replace:true — the group registration's school is authoritative, so an
  // existing member who was on a different school is moved to this one (W7 school
  // clash: an invited account must reflect the group's school, not their old one).
  await linkMembersToSchoolByName(db, [memberId], {
    name: schoolName || null,
    address_street: (reg.school_address_street as string) || null,
    address_city: (reg.school_address_city as string) || null,
    address_state: (reg.school_address_state as string) || null,
    address_zip: (reg.school_address_zip as string) || null,
  }, { replace: true })

  // Record the event in the joining member's Event Activity (event_participations).
  await recordEventParticipation(db, { memberId, eventSlug, eventTitle, registrationId })

  // Grant access to any Space linked to this event (community_space_sources keys
  // events by slug). Registering for the event is what confers Space access, so
  // the joining member must be rostered into the event's Space(s). Non-fatal.
  await syncObjectSpaceRoster(db, 'event', eventSlug, memberId)
  // Safety net, mirroring the group-registration flow: if the per-member grant
  // above failed transiently, the member is already in the event's cohort roster
  // (recordEventParticipation ran just before), so reconciling the event's linked
  // Space rosters recovers them. Non-fatal, idempotent.
  await reconcileEventSpaceRoster(db, eventSlug)

  // Trigger the appropriate DocuSign agreement (minor consent, or self-signed
  // adult/mentor participation agreement) based on the participant's age and role.
  await dispatchAgreement(db, {
    participantId,
    memberId,
    eventSlug,
    eventTitle,
    firstName:         person.first_name,
    lastName:          person.last_name,
    email:             person.email,
    phone:             person.phone ?? undefined,
    dateOfBirth:       person.date_of_birth ?? undefined,
    eventRole:         person.event_role,
    schoolName:        schoolName || undefined,
    schoolState:       (reg.school_address_state as string) || undefined,
    guardianFirstName: person.ec_first_name ?? undefined,
    guardianLastName:  person.ec_last_name ?? undefined,
    guardianEmail:     person.ec_email ?? undefined,
    guardianPhone:     person.ec_phone ?? undefined,
    relationship:      person.ec_relationship ?? undefined,
    grade:             person.grade,
  })
}
