-- 094_canonical_tiers.sql
-- Standardization sweep · Phase 1 — canonical membership tiers.
--
-- Source of truth: Operations/Content Plan.xlsx ("Web App Planning" + "Teacher
-- Content" tabs). This brings the live membership_tiers table onto the canonical
-- 10-tier / 3-family schema:
--   School students : Explorer $0  · Pathfinder $59 · Scholar $119
--   College & univ. : Alumni  $0  · Contributor $249 · Counselor $499
--   Educators       : Educator $0 · Catalyst $149 · Innovator $499 · Trailblazer $999
--
-- What this migration does:
--   1. Reprices every paid tier to canonical (cents).
--   2. Adds the Catalyst educator tier (was missing entirely).
--   3. Cleans sort_order into a contiguous, family-ordered sequence.
--   4. Repoints the two signup grant rules that referenced legacy tiers.
--   5. Retires the legacy tiers (Advisor / Donor / Expert / Luminary) — verified
--      0 live members and 0 dependent rows except the 2 grant rules repointed above.
--
-- ⚠ OPS (Stripe): Stripe Price objects are immutable, so the new amounts need NEW
--   Stripe Prices. This migration NULLs stripe_price_id (+ monthly) on every
--   repriced paid tier and on Catalyst, which DISABLES paid membership checkout for
--   those tiers until the new Price IDs are created and written back. Pre-launch
--   this is safe (0 paying members) and prevents checkout charging the old amount.
--   The new annual Price IDs are set in migration 095_tier_stripe_prices.sql.
--
-- ⚠ FUTURE WORK (adult-mentor membership): the "adult mentor signup" grant is
--   repointed to Subscriber as an INTERIM. There is no canonical free tier for adult
--   mentors yet; this is a deliberate placeholder pending the mentor/volunteer
--   membership design. See lib/membership-rules.ts and the project memory note.
--
-- Store/academy discount rows for Catalyst (canonical 5% / 5%) are intentionally
-- deferred to the store-discount phase.

begin;

-- 1. Reprice paid tiers to canonical and clear now-stale Stripe prices (set in 095).
update membership_tiers set annual_cost_cents = 5900,  stripe_price_id = null, stripe_price_id_monthly = null where name = 'Pathfinder';
update membership_tiers set annual_cost_cents = 11900, stripe_price_id = null, stripe_price_id_monthly = null where name = 'Scholar';
update membership_tiers set annual_cost_cents = 24900, stripe_price_id = null, stripe_price_id_monthly = null where name = 'Contributor';
update membership_tiers set annual_cost_cents = 49900, stripe_price_id = null, stripe_price_id_monthly = null where name = 'Counselor';
update membership_tiers set annual_cost_cents = 49900, stripe_price_id = null, stripe_price_id_monthly = null where name = 'Innovator';
update membership_tiers set annual_cost_cents = 99900, stripe_price_id = null, stripe_price_id_monthly = null where name = 'Trailblazer';

-- 2. Add Catalyst ($149) — educator family, resources-only value (no bundled sessions).
insert into membership_tiers
  (name, grouping_title, age_bracket, annual_cost_cents, stripe_price_id, is_free, sort_order,
   badge_color, default_grant_months, eligible_roles, includes_free_mentoring,
   mentoring_credits_grant, workshop_credits_grant, description)
select
  'Catalyst', 'Professional', 'adult', 14900, null, false, 8,
  'violet', 12, array['teacher'], false, 0, 0,
  'Educator tier — everything in Educator plus advanced planning packs, assessment tools and lesson plans (resource ladder).'
where not exists (select 1 from membership_tiers where name = 'Catalyst');

-- 3. Canonical, contiguous sort order (family-grouped; clears legacy dupes).
update membership_tiers set sort_order = 1  where name = 'Explorer';
update membership_tiers set sort_order = 2  where name = 'Pathfinder';
update membership_tiers set sort_order = 3  where name = 'Scholar';
update membership_tiers set sort_order = 4  where name = 'Alumni';
update membership_tiers set sort_order = 5  where name = 'Contributor';
update membership_tiers set sort_order = 6  where name = 'Counselor';
update membership_tiers set sort_order = 7  where name = 'Educator';
update membership_tiers set sort_order = 8  where name = 'Catalyst';
update membership_tiers set sort_order = 9  where name = 'Innovator';
update membership_tiers set sort_order = 10 where name = 'Trailblazer';
update membership_tiers set sort_order = 20 where name = 'Subscriber';
update membership_tiers set sort_order = 21 where name = 'Parent/Guardian';

-- 4. Repoint grant rules off the legacy tiers before deleting them.
update tier_grant_rules
   set grant_tier_id = (select id from membership_tiers where name = 'Alumni'),
       name = 'Signup: college → Alumni'
 where name = 'Signup: college → Advisor';

-- Interim: adult mentors get Subscriber (no canonical free mentor tier yet — future work).
update tier_grant_rules
   set grant_tier_id = (select id from membership_tiers where name = 'Subscriber'),
       name = 'Signup: adult mentor → Subscriber (interim)'
 where name = 'Signup: adult mentor → Donor';

-- 5. Retire legacy tiers. Defensive cleanup of dependent rows first (all 0 on prod,
--    kept for idempotency / drifted environments), then delete the tiers themselves.
do $$
declare legacy uuid[] := array(select id from membership_tiers where name in ('Advisor','Donor','Expert','Luminary'));
begin
  delete from community_space_tiers where tier_id = any(legacy);
  delete from content_entitlements  where tier_id = any(legacy);
  delete from session_entitlements  where tier_id = any(legacy);
  delete from store_tier_discounts  where tier_id = any(legacy);
  delete from membership_tiers      where id      = any(legacy);
end $$;

commit;
