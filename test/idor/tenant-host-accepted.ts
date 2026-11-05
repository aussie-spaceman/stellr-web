// Tenant-host outcomes that may stay above 0 at the S5 gate: "An accepted outcome is
// listed by route with its reason (for example a capability token) and the owner's
// approval" (docs/TENANCY-S5.md). Keyed `<route file> <METHOD> <persona> <direction>`,
// and pinned to the entry approved: an approval does not cover a case that gets worse.
//
// Empty: nobody has approved one. An entry is the owner's to give, not a test author's,
// and test/idor/tenant-host-routes.test.ts fails on one with no approval.
import type { AcceptedHostOutcome } from './tenant-host-targets'

export const TENANT_HOST_ACCEPTED: Record<string, AcceptedHostOutcome> = {}

/**
 * Cases that prove nothing about a record because the route reads none for this caller.
 * Keyed `<route file> <METHOD> <persona>`, or `<route file> <METHOD>` for both people.
 * Any other unproven case fails: its fixture has to get it to the code that decides.
 */
export const TENANT_HOST_UNPROVEN: Record<string, string> = {
  'app/api/check-in-desk/manifest/route.ts GET': 'A web app manifest: it echoes the slug into a URL and reads no record.',
  'app/api/check-in/route.ts DELETE': 'Clears the caller’s own cookie and reads no record.',
  'app/api/email/unsubscribe/route.ts GET': 'Renders a form holding the token. Nothing is read until the POST.',
  'app/api/credentials/[number]/pdf/route.ts GET anonymous': 'Refused at sign-in, before the number is used.',
  'app/api/credentials/[number]/visibility/route.ts POST anonymous': 'Refused at sign-in, before the number is used.',
  'app/api/volunteer/interest/route.ts POST anonymous': 'Refused at sign-in, before the slug is used.',
}
