// Tenant-host outcomes that may stay above 0 at the S5 gate: "An accepted outcome is
// listed by route with its reason (for example a capability token) and the owner's
// approval" (docs/TENANCY-S5.md). Keyed `<route file> <METHOD> <persona> <direction>`,
// and pinned to the entry approved: an approval does not cover a case that gets worse.
//
// An entry is the owner's to give, not a test author's: each one cites the decision in
// docs/S5-DECISION-REGISTER.md that approved it, and test/idor/tenant-host-routes.test.ts
// fails on one with no approval.
import type { AcceptedHostOutcome } from './tenant-host-targets'

// W7-15 (A10b, #660): on Stellr's host the opt-out link is its holder's own, for Stellr's
// marketing list. A members row has no tenant, so the route cannot tell another tenant's
// person from Stellr's; refusing would answer "unsubscribed" while Stellr's mail kept coming.
const W7_15_REASON =
  'Capability token, decision W7-15: on Stellr’s host a valid opt-out link leaves Stellr’s own marketing list and names its holder’s address back, whichever other tenant also knows them. Refusing it would show "unsubscribed" while Stellr’s campaigns kept coming. On another tenant’s host the link acts on nothing (A10b).'
const W7_15_APPROVAL = { approvedBy: 'The owner, in chat: W7-15, with #660', approvedOn: '2026-11-12' }

export const TENANT_HOST_ACCEPTED: Record<string, AcceptedHostOutcome> = {
  'app/api/email/unsubscribe/route.ts POST anonymous stellr_to_canary': { outcome: 'leak', reason: W7_15_REASON, ...W7_15_APPROVAL },
  'app/api/email/unsubscribe/route.ts POST participant stellr_to_canary': { outcome: 'leak', reason: W7_15_REASON, ...W7_15_APPROVAL },
}

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
