/**
 * Another tenant's survey email is held (S5 wave 7, decision W7-16, as A10a held team
 * profiles). Every link in a survey email (lib/survey/send.ts linksFor: the survey, the
 * stop-reminders page and the one-click unsubscribe) is on Stellr's host, which since A10b
 * answers another tenant's survey token as one nobody holds, so any such email would carry
 * a dead link. Its invitations are still made, so nothing is lost, but they are marked held
 * (HELD_FOR_TENANT_SURVEY, on the invitation's last_send_error, which the admin Survey tab
 * shows) and never sent, and they claim none of the daily survey email budget.
 *
 * Every survey send path asks surveySendsHeld, from the distribution row already in hand:
 * no read. Stellr's surveys (a NULL tenant is Stellr's) are not held and send as before.
 *
 * Lift it when tenant-host survey links exist: linksFor builds each link on the
 * distribution's own tenant host, and that host's survey pages and routes serve the token.
 * Lifting is this predicate alone; held invitations are still queued and send on the next run.
 */
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

/** What the admin Survey tab shows on a held invitation (stored in last_send_error). */
export const HELD_FOR_TENANT_SURVEY = 'Held: surveys for this organisation’s events can’t be sent yet.'

/** What an admin's resend answers for a held invitation. */
export const HELD_FOR_TENANT_SURVEY_RESEND = 'Surveys for this organisation’s events can’t be sent yet.'

/** Is this tenant's survey email held? `tenantId` is distributionTenant(d): NULL already read as Stellr's. */
export function surveySendsHeld(tenantId: string): boolean {
  return tenantId !== STELLR_TENANT_ID
}
