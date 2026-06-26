-- 095_tier_stripe_prices.sql
-- Standardization sweep · Phase 1 follow-up to migration 094.
--
-- Migration 094 repriced every paid tier to canonical and NULLed their stripe_price_id
-- (Stripe Prices are immutable). The new annual Stripe Prices were created 2026-06-26;
-- this migration writes their IDs back so paid membership checkout works again.
--
-- Monthly prices are intentionally left NULL (annual billing only for now).
-- Idempotent: re-running sets the same IDs.

update membership_tiers set stripe_price_id = 'price_1TmgqbFHHVJXH5Abq54VFYjc' where name = 'Pathfinder';
update membership_tiers set stripe_price_id = 'price_1Tmgr9FHHVJXH5Abq4WMe35g' where name = 'Scholar';
update membership_tiers set stripe_price_id = 'price_1TmgreFHHVJXH5Ab5MkZngjb' where name = 'Contributor';
update membership_tiers set stripe_price_id = 'price_1Tmgs1FHHVJXH5AbLcw03Fn0' where name = 'Counselor';
update membership_tiers set stripe_price_id = 'price_1TmgsVFHHVJXH5AbBoBL8Eog' where name = 'Catalyst';
update membership_tiers set stripe_price_id = 'price_1TmgtBFHHVJXH5AbEcJHCv8U' where name = 'Innovator';
update membership_tiers set stripe_price_id = 'price_1TlXH0FHHVJXH5AbxqSzi064' where name = 'Trailblazer';
