-- 115_tier_benefits_extra_price.sql
-- Entitlements cutover · deferral #2 — give the extra-session topup price a home in
-- the canonical tier_benefits table so session_entitlements can be retired.
--
-- session_entitlements held two things: the coaching allowance (included_sessions/
-- validity — now canonical in entitlements.tier_benefits, migration 105) and
-- extra_stripe_price_id (the Stripe price for buying an extra session at a tier).
-- The allowance columns are stale placeholders; extra_stripe_price_id is NULL for
-- every row (the per-session extra-purchase feature was never configured, and the
-- live topup path is coaching/topup + mentoring/topup). Co-locate the extra-price
-- with the allowance it tops up: add it to tier_benefits, keyed by (tier_code, kind)
-- like the rest of the row. No backfill — there are no non-null prices to move.

alter table entitlements.tier_benefits add column if not exists extra_stripe_price_id text;
