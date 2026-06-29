-- Persist the monthly membership price (in cents) on membership_tiers, mirroring
-- annual_cost_cents. The /membership Annual·Monthly toggle and the /join checkout
-- previously read the monthly amount LIVE from Stripe on every render
-- (lib/membership-monthly via stripe.prices.retrieve). That adds latency to public
-- marketing pages and a silent-failure mode: if the Stripe call fails the whole
-- toggle vanishes. Storing the amount alongside annual_cost_cents makes display
-- deterministic and removes the per-render Stripe round-trip.
--
-- stripe_price_id_monthly remains the source of truth for what is actually CHARGED
-- at checkout — if a monthly price changes in Stripe, update monthly_cost_cents to
-- match (same contract annual_cost_cents already has with stripe_price_id).
--
-- Seed values are the live Stripe monthly amounts (verified 2026-06-29):
--   Pathfinder $5 · Scholar $12 · Contributor $21 · Counselor $41.70.

alter table membership_tiers
  add column if not exists monthly_cost_cents integer;

update membership_tiers set monthly_cost_cents = 500  where name = 'Pathfinder';
update membership_tiers set monthly_cost_cents = 1200 where name = 'Scholar';
update membership_tiers set monthly_cost_cents = 2100 where name = 'Contributor';
update membership_tiers set monthly_cost_cents = 4170 where name = 'Counselor';
