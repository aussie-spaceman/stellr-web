-- 100_academy_discount.sql
-- Adds the canonical per-tier ACADEMY discount (0–25%) as a source of truth and seeds it.
--
-- The academy discount applies to mentoring / coaching / training purchases (distinct from
-- the STORE discount in store_tier_discounts). It was display-only in the membership UI
-- (tier-data.ts) with no DB source, so academy checkouts charged full price. This column is
-- the single source of truth; checkout routes apply it via dynamic pricing (lib/academy-discount.ts).

alter table membership_tiers
  add column if not exists academy_discount_percent integer not null default 0;

update membership_tiers set academy_discount_percent = v.pct
from (values
  ('Explorer', 0), ('Pathfinder', 15), ('Scholar', 25),
  ('Alumni', 10), ('Contributor', 15), ('Counselor', 25),
  ('Educator', 5), ('Catalyst', 5), ('Innovator', 10), ('Trailblazer', 10)
) as v(name, pct)
where membership_tiers.name = v.name;
