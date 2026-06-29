-- 113_entitlements_seed_tier_discounts.sql
-- Entitlements cutover · deferral #1 — seed the academy tier discount into the
-- pricing engine's single source of truth.
--
-- The academy discount lives in membership_tiers.academy_discount_percent (migration
-- 100) and is applied as dynamic pricing by the academy checkout routes
-- (lib/academy-discount). But the entitlements pricing engine reads tier discounts
-- from entitlements.discounts (fn_tier_discount_pct), which had NO tier rows seeded —
-- so an à-la-carte booking via entitlements/checkout (getQuote) applied 0% while
-- mentoring/register applied the real discount. Seed the discounts table from the
-- column so both paths agree.
--
-- applies_to = null → the discount covers ALL offering types (matches the academy
-- discount's type-agnostic shape). Idempotent: clears + re-seeds the tier rows.
-- (Full unification — repoint lib/academy-discount to read this table + retire the
-- column — is a later step; this only removes the drift.)

delete from entitlements.discounts where kind = 'tier';

insert into entitlements.discounts (kind, tier_code, discount_type, percent, applies_to, is_active)
select 'tier', t.code, 'percent', mt.academy_discount_percent, null, true
from public.membership_tiers mt
join entitlements.tiers t on t.membership_tier_id = mt.id
where coalesce(mt.academy_discount_percent, 0) > 0;
