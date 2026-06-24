-- 078_credit_wallet_generalize.sql
-- Rec 1 of the Workshops & Cohorts access plan (docs/WORKSHOP-COHORT-ACCESS-PLAN.md).
--
-- Generalises the mentoring credit ledger (session_credits, added 021 + repurposed
-- 070) into a typed WALLET that serves two products from one balance machinery:
--   • cohort credits   — session_type = 'mentoring' (existing; 1 credit = 1 cohort)
--   • workshop credits — session_type = 'workshop'  (NEW; 1 credit = 1 workshop)
-- The 1:1 coaching/mentoring extra-session credits keep their existing types.
--
-- Also adds:
--   • membership_tiers.workshop_credits_grant — per-tier annual workshop allowance,
--     the sibling of the existing mentoring_credits_grant (070).
--   • session_credits.source = 'grant' — credits handed out by a grant rule
--     (event / tier), alongside allowance | purchase | topup. The refund path
--     (lib/mentoring.ts refundCohortMembers) returns any non-'purchase' credit to
--     balance, so 'grant' credits behave correctly on container cancellation.
--
-- Conventions: ADD COLUMN IF NOT EXISTS; DROP/ADD named CHECK constraints
-- (Postgres default names <table>_<column>_check) to widen the allowed values.

-- ─── 1. session_credits.session_type: allow 'workshop' ──────────────────────
ALTER TABLE public.session_credits DROP CONSTRAINT IF EXISTS session_credits_session_type_check;
ALTER TABLE public.session_credits
  ADD CONSTRAINT session_credits_session_type_check
  CHECK (session_type IN ('coaching', 'mentoring', 'workshop'));

-- ─── 2. session_credits.source: allow 'grant' ──────────────────────────────
ALTER TABLE public.session_credits DROP CONSTRAINT IF EXISTS session_credits_source_check;
ALTER TABLE public.session_credits
  ADD CONSTRAINT session_credits_source_check
  CHECK (source IN ('allowance', 'purchase', 'topup', 'grant'));

-- ─── 3. membership_tiers: per-tier annual workshop credit grant ─────────────
-- Mirrors mentoring_credits_grant (070). Stays 0 until set per tier in the admin
-- Membership & access screen. Cohort + workshop allowances are independent.
ALTER TABLE public.membership_tiers
  ADD COLUMN IF NOT EXISTS workshop_credits_grant integer NOT NULL DEFAULT 0;
