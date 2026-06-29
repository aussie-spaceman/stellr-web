-- 105_entitlements_tier_benefits_seed.sql
-- Entitlements cutover · Phase 1 — seed tier_benefits academy ALLOWANCES from canonical
-- (Operations/Content Plan.xlsx), replacing the placeholder rows (which wrongly gave EVERY
-- paid tier coaching_session q6 + cohort_access q1).
--
-- Model (lib/entitlements.ts): coaching → kind 'coaching_session'; mentoring → kind
-- 'cohort_access' (offering 'mentoring_cohort'); quantity = included sessions per period.
--
-- Mapping (canonical, CUMULATIVE — a member holds one tier and the copy says "everything in
-- X plus …", so each tier lists its full academy allowance):
--   Pathfinder  : 4 mentoring
--   Scholar     : 4 mentoring (via Pathfinder) + 3 coaching
--   Contributor : 8 mentoring
--   Counselor   : 8 mentoring (via Contributor) + 1 coaching
--   Innovator   : 8 mentoring
--   Trailblazer : 8 mentoring (via Innovator)
--   Explorer/Alumni/Educator/Catalyst/Subscriber/Parent : none (resources/none)
--
-- JUDGEMENT CALLS (tunable via admin setTierAllocationQuantity, low risk pre-launch):
--   • period 'one_off' + validity 365 = an ANNUAL allowance that resets each membership year
--     (canonical "resets annually"); the placeholder's 'quarterly' would over-grant 4×.
--   • Coaching is Scholar/Counselor only; mentoring inherits down the family.
-- Discounts are intentionally NOT seeded here — tier discounts live in entitlements.discounts
-- and are wired in Phase 3 (booking/pricing).
--
-- Safe to replace wholesale: member_grant_runs (FK → tier_benefits) has 0 rows.

delete from entitlements.tier_benefits;

insert into entitlements.tier_benefits (tier_code, kind, quantity, period, validity_days) values
  ('scholar',     'coaching_session', 3, 'one_off', 365),
  ('counselor',   'coaching_session', 1, 'one_off', 365),
  ('pathfinder',  'cohort_access',    4, 'one_off', 365),
  ('scholar',     'cohort_access',    4, 'one_off', 365),
  ('contributor', 'cohort_access',    8, 'one_off', 365),
  ('counselor',   'cohort_access',    8, 'one_off', 365),
  ('innovator',   'cohort_access',    8, 'one_off', 365),
  ('trailblazer', 'cohort_access',    8, 'one_off', 365);
