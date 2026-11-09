import type { SupabaseClient } from '@supabase/supabase-js'
import { dispatchAgreement } from '@/lib/docusign-agreements'
import {
  linkMembersToSchoolByName,
  reconcileEventSpaceRoster,
  recordParticipation,
  syncObjectSpaceRoster,
} from '@/lib/community/event-hooks'
import { sendTenantRegistrationConfirmation } from '../tenant-confirmation'
import type { ConfirmedJoinLink } from './gate'
import type { GroupJoiner } from './identify'

/**
 * POST /api/register/group-join, what follows the row: the school, event activity,
 * the event's Spaces and the agreement. Run in this order on every join today.
 *
 * S5 A7: all of it is Stellr's, so a tenant's event gets none of it, and the person
 * joining gets the tenant's confirmation email instead (B14's tenant share). The
 * agreement is a minor's consent, and for a tenant's event it is held, not sent as
 * Stellr: Stellr's DocuSign templates and sender are Stellr's, and the signing
 * engine has no tenant sender yet (A11). Whether a tenant's minors may join before
 * that exists is an owner decision.
 */
export async function runGroupJoinHooks(
  db: SupabaseClient,
  link: ConfirmedJoinLink,
  joiner: GroupJoiner,
  participantId: string,
): Promise<void> {
  const { reg, registrationId, eventSlug, eventTitle, schoolName, context } = link
  const { person, memberId } = joiner

  if (!context.isPlatformOwner || !memberId) {
    if (!context.isPlatformOwner) {
      await sendTenantRegistrationConfirmation(db, {
        tenantId: context.tenantId,
        to: person.email,
        firstName: person.first_name,
        eventTitle,
        kind: 'group_join',
      })
    }
    return
  }

  // Link the joining member to the group's school so it surfaces in
  // /admin/schools and on their member page — not just as participant text.
  // replace:true — the group registration's school is authoritative, so an
  // existing member who was on a different school is moved to this one (W7 school
  // clash: an invited account must reflect the group's school, not their old one).
  await linkMembersToSchoolByName(context, db, [memberId], {
    name: schoolName || null,
    address_street: (reg.school_address_street as string) || null,
    address_city: (reg.school_address_city as string) || null,
    address_state: (reg.school_address_state as string) || null,
    address_zip: (reg.school_address_zip as string) || null,
  }, { replace: true })

  // Record the event in the joining member's Event Activity (event_participations).
  await recordParticipation(context, db, { memberId, eventSlug, eventTitle, registrationId })

  // Grant access to any Space linked to this event (community_space_sources keys
  // events by slug). Registering for the event is what confers Space access, so
  // the joining member must be rostered into the event's Space(s). Non-fatal.
  await syncObjectSpaceRoster(context, db, 'event', eventSlug, memberId)
  // Safety net, mirroring the group-registration flow: if the per-member grant
  // above failed transiently, the member is already in the event's cohort roster
  // (recordEventParticipation ran just before), so reconciling the event's linked
  // Space rosters recovers them. Non-fatal, idempotent.
  await reconcileEventSpaceRoster(context, db, eventSlug)

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
