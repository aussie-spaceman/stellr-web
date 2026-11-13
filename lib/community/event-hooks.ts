import type { SupabaseClient } from '@supabase/supabase-js'
import { autoGrantBaseMembership as grantBaseMembership } from '@/lib/auto-membership-grant'
import { recordEventParticipation } from '@/lib/event-participation-sync'
import { syncMemberOptionSelections as syncOptions } from '@/lib/member-profile-options'
import {
  linkMembersToRegistrationSchool as linkToRegistrationSchool,
  linkMembersToSchoolByName as linkToSchool,
  resolveAndLinkSchool as resolveSchool,
} from '@/lib/school-link'
import {
  reconcileEventSpaceRoster as reconcileRoster,
  syncObjectSpaceRoster as syncRoster,
  type SpaceObjectType,
} from '@/lib/space-inheritance'

// The hooks from an event's registration into Stellr's community and membership
// code, and into the shared person record (multi-tenancy plan S5, B8). Each does its
// work only for the platform owner's event. test/tenant-surface.test.ts stops its
// walk at this file, and it holds any other route from a tenant-host page into those
// modules to a baseline that only shrinks.
//
// NOTHING IMPORTS THIS YET, so it holds nothing back on its own:
//   - The register routes call these modules directly through lib/registration until
//     A7 moves them here.
//   - The team and sheet paths reach Stellr's code from Stellr's host, which the walk
//     cannot see. recordEventParticipationForRegistration refuses another tenant's row
//     itself, and they call linkMembersToRegistrationSchool directly until A8 moves
//     them here.
// For Stellr, each hook passes its arguments through unchanged.
//
// The school and profile hooks are here because a tenant's registration should write
// only participant, registration and audit rows. The participant row carries what the
// form submitted, including school, ethnicity and dietary needs. These hooks write the
// person's record, which is shared across tenants, and the shared school directory.

/**
 * Pass what the event resolved to: lib/registration/eligibility's context fits.
 * Only a positive read makes an event Stellr's. A context that could not be
 * resolved has isPlatformOwner false, so a miss does none of this work.
 */
export interface EventHookContext {
  isPlatformOwner: boolean
}

const isStellrEvent = (event: EventHookContext) => event.isPlatformOwner === true

/**
 * Stellr: the competition roster, the Space roster, the event_participations row,
 * its activity entry and the grant rules. Any other tenant: nothing. The row and its
 * entry would show on Stellr's own member and staff pages, which read them unscoped.
 */
export async function recordParticipation(
  event: EventHookContext,
  db: SupabaseClient,
  p: Parameters<typeof recordEventParticipation>[1],
): Promise<void> {
  if (!isStellrEvent(event)) return
  return recordEventParticipation(db, p)
}

export async function syncObjectSpaceRoster(
  event: EventHookContext,
  db: SupabaseClient,
  objectType: SpaceObjectType,
  objectRef: string,
  memberId: string,
): Promise<void> {
  if (!isStellrEvent(event)) return
  return syncRoster(db, objectType, objectRef, memberId)
}

export async function reconcileEventSpaceRoster(
  event: EventHookContext,
  db: SupabaseClient,
  eventSlug: string,
): Promise<void> {
  if (!isStellrEvent(event)) return
  return reconcileRoster(db, eventSlug)
}

export async function autoGrantBaseMembership(
  event: EventHookContext,
  db: SupabaseClient,
  memberId: string | null | undefined,
): Promise<void> {
  if (!isStellrEvent(event)) return
  return grantBaseMembership(db, memberId)
}

export async function linkMembersToSchoolByName(
  event: EventHookContext,
  db: SupabaseClient,
  memberIds: Parameters<typeof linkToSchool>[1],
  school: Parameters<typeof linkToSchool>[2],
  opts?: Parameters<typeof linkToSchool>[3],
): Promise<void> {
  if (!isStellrEvent(event)) return
  // The same arguments the caller gave: no trailing undefined where it gave no options.
  return opts === undefined ? linkToSchool(db, memberIds, school) : linkToSchool(db, memberIds, school, opts)
}

export async function linkMembersToRegistrationSchool(
  event: EventHookContext,
  db: SupabaseClient,
  registrationId: string,
  memberIds: Parameters<typeof linkToRegistrationSchool>[2],
): Promise<void> {
  if (!isStellrEvent(event)) return
  return linkToRegistrationSchool(db, registrationId, memberIds)
}

/** Any other tenant: null, as for a school that could not be resolved. */
export async function resolveAndLinkSchool(
  event: EventHookContext,
  db: SupabaseClient,
  memberIds: Parameters<typeof resolveSchool>[1],
  school: Parameters<typeof resolveSchool>[2],
): ReturnType<typeof resolveSchool> {
  if (!isStellrEvent(event)) return null
  return resolveSchool(db, memberIds, school)
}

export async function syncMemberOptionSelections(
  event: EventHookContext,
  db: SupabaseClient,
  selections: Parameters<typeof syncOptions>[1],
): Promise<void> {
  if (!isStellrEvent(event)) return
  return syncOptions(db, selections)
}

/**
 * A Staff agreement was signed (lib/esign/completion.ts). Staff is Stellr's alone and
 * its prerequisites read the Academy training tables, so the call comes through here,
 * where the tenant-surface walk stops. The envelope type is 'staff' only on Stellr's
 * own envelopes. Never throws: the daily Staff sweep is the backstop.
 */
export async function onStaffAgreementSigned(event: EventHookContext, db: SupabaseClient, memberId: string): Promise<void> {
  if (!isStellrEvent(event)) return
  const { nudgeStaff } = await import('@/lib/staff')
  await nudgeStaff(db, { memberId }, 'agreement_signed')
}
