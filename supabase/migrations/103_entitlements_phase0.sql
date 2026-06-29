-- 103_entitlements_phase0.sql
-- Entitlements full-cutover · Phase 0 (blocker fixes). See docs/ENTITLEMENTS-CUTOVER-PLAN.md.
--
-- (1) Blocker 1: entitlements is keyed off member_id — drop the unconstrained participant_id
--     columns (no FK, empty tables). Never reference public.participants.
-- (2) Blocker 3: re-sync the entitlements.tiers PROJECTION from the authoritative
--     membership_tiers. It had gone stale (legacy tiers Advisor/Donor/Expert/Luminary still
--     present, no Catalyst, pre-094 prices) because membership_tiers is the source of truth and
--     094–101 only updated it. entitlements.tiers stays a TABLE (it's an FK target for
--     tier_benefits.tier_code / discounts.tier_code), kept in sync — it is NOT a view.
--     Verified safe: tier_benefits references only canonical codes; discounts is empty.
--
-- All statements idempotent. FOLLOW-UP (Phase 0 next): add an AFTER-trigger on membership_tiers
-- so this projection self-maintains (one-time re-sync below fixes the current drift).

-- (1) participant_id → keyed off member_id
alter table entitlements.entitlements drop column if exists participant_id;
alter table entitlements.bookings      drop column if exists participant_id;

-- (2) re-sync the tier projection from membership_tiers (authoritative)
delete from entitlements.tiers t
  where not exists (select 1 from membership_tiers m where m.id = t.membership_tier_id);

update entitlements.tiers t set
  code = lower(regexp_replace(m.name, '[^A-Za-z0-9]+', '_', 'g')),
  name = m.name,
  annual_price_cents = m.annual_cost_cents,
  store_discount_pct = coalesce((select percent_off from store_tier_discounts d where d.tier_id = m.id and d.scope = 'all' limit 1), 0),
  stripe_price_id = m.stripe_price_id,
  stripe_price_id_monthly = m.stripe_price_id_monthly,
  is_free = m.is_free
from membership_tiers m
where t.membership_tier_id = m.id;

insert into entitlements.tiers (code, membership_tier_id, name, annual_price_cents, store_discount_pct, stripe_price_id, stripe_price_id_monthly, is_free)
select lower(regexp_replace(m.name, '[^A-Za-z0-9]+', '_', 'g')), m.id, m.name, m.annual_cost_cents,
  coalesce((select percent_off from store_tier_discounts d where d.tier_id = m.id and d.scope = 'all' limit 1), 0),
  m.stripe_price_id, m.stripe_price_id_monthly, m.is_free
from membership_tiers m
where not exists (select 1 from entitlements.tiers t where t.membership_tier_id = m.id);
