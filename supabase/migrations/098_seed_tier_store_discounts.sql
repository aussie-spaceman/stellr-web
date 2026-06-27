-- 098_seed_tier_store_discounts.sql
-- Standardization sweep follow-up — seed the blanket per-tier STORE discount (PRD §12 /
-- Content Plan canonical). The store (lib/store/discounts.ts resolveTierPercent) read an
-- EMPTY store_tier_discounts table, so every tier got 0% off at checkout. This inserts one
-- scope='all' row per canonical tier with its store discount %. Idempotent: skips a tier
-- that already has a tier-wide ('all') row, so admin-set rows are never clobbered.
--
-- (The ACADEMY discount 0–25% is a SEPARATE, still-unwired concern — it's display-only in
-- tier-data.ts and not yet applied to mentoring/coaching/training checkout.)

insert into store_tier_discounts (tier_id, scope, product_id, category, percent_off)
select t.id, 'all', null, null, v.pct
from (values
  ('Explorer', 5), ('Pathfinder', 10), ('Scholar', 10),
  ('Alumni', 5), ('Contributor', 10), ('Counselor', 10),
  ('Educator', 5), ('Catalyst', 5), ('Innovator', 10), ('Trailblazer', 10)
) as v(name, pct)
join membership_tiers t on t.name = v.name
where not exists (
  select 1 from store_tier_discounts d where d.tier_id = t.id and d.scope = 'all'
);
