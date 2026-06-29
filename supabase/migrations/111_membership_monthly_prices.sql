-- Monthly Stripe prices for the school + college paid tiers.
-- Monthly billing is offered ONLY for these four tiers; the teacher tiers
-- (Catalyst / Innovator / Trailblazer) remain annual-only (left null).
-- Annual price ids are unchanged (migration 095). The 104 sync trigger mirrors
-- stripe_price_id_monthly into entitlements.tiers on update.

update membership_tiers set stripe_price_id_monthly = 'price_1Tni89FHHVJXH5AbwAOkAexz' where name = 'Pathfinder';
update membership_tiers set stripe_price_id_monthly = 'price_1Tni8OFHHVJXH5AbxdKVUK0A' where name = 'Scholar';
update membership_tiers set stripe_price_id_monthly = 'price_1Tni8dFHHVJXH5AbQ22k9UfB' where name = 'Contributor';
update membership_tiers set stripe_price_id_monthly = 'price_1Tni8zFHHVJXH5AbN18kOaZI' where name = 'Counselor';
