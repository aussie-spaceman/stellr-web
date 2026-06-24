-- 074_counselor_tier_rename.sql
--
-- The membership tier was seeded with the British spelling "Counsellor", but the
-- application code (lib/tiers.ts → TIER_GROUPS college column) uses the American
-- "Counselor" as the stable identity. The mismatch meant the Counselor checkbox in
-- the admin Spaces "Access & tiers" grid resolved to no id and rendered greyed out
-- and unselectable. Align the DB to the code's canonical spelling.

update public.membership_tiers
set name = 'Counselor'
where name = 'Counsellor';
