// lib/credits.ts — RETIRED wallet (entitlements cutover, 2026-06-29).
//
// This module was the shared access-credit wallet over the `session_credits` table
// (cohort + workshop enrollment credits). The entitlements cutover replaced it
// end-to-end: mentoring + coaching enrollment now draw the entitlements ledger
// (lib/entitlements.ts: bookCohortFromAllocation / bookCoachingSessionFromAllocation),
// rule-based grants moved to grantAdhocEntitlement (Phase 4), paid topups to
// grantPurchasedLot (Phase 3), and one-off cohort/workshop purchases + refunds onto
// confirmPaidBooking / fn_cancel_cohort (Phase 3b). All wallet functions
// (syncAllowance / getCredits / consumeOldestCredit / grantCredits) were deleted —
// they had zero callers and `session_credits` is no longer read or written by live
// code. The table is dropped in a separate post-deploy migration (Phase 5).
//
// `CreditType` survives only as the tier_grant_rules.grant_credit_type CONFIG value
// (mapped to an entitlement kind at grant time in lib/membership-grants.ts).
// See [[project_canonical_schema]].

/** Rule-config credit axis: 'mentoring' → cohort_access, 'workshop' → coaching_session. */
export type CreditType = 'mentoring' | 'workshop'
