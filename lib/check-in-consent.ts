// Check-in and a tenant event's guardian consent (S5 wave 6).
//
// A 14-17-year-old registered for another organiser's event is consent-pending
// until a parent or guardian signs (lib/registration/tenant-guardian-consent.ts).
// The database refuses to check them in: the trigger
// zzz_participants_refuse_unconsented_check_in raises 23514 with the message
// 'guardian_consent_pending' on any write that sets checked_in_at. This tells that
// refusal from any other failed write, so a route can say why.

/** Shown to the participant at the door. A proposal for the owner. */
export const GUARDIAN_CONSENT_PENDING_CHECK_IN =
  "You can't check in yet: your parent or guardian hasn't signed the consent form. Please see the registration desk."

/** Shown to staff at the desk. A proposal for the owner. */
export const GUARDIAN_CONSENT_PENDING_DESK =
  "Not checked in: a parent or guardian hasn't signed the consent form for this participant yet. In a group, check the others in one at a time."

/** The trigger's refusal, as PostgREST reports it. */
export function isConsentPendingRefusal(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return !!error && error.code === '23514' && (error.message ?? '').includes('guardian_consent_pending')
}
