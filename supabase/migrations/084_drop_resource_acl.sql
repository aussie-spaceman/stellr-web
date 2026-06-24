-- 084_drop_resource_acl.sql
-- Global Resources Catalogue — PR5 (access config + per-resource ACL cleanup).
--
-- Decision 6b: a resource's access is inherited from the container it's attached
-- to — there is no per-resource ACL. The catalogue (PR1) already stopped reading
-- these; this migration drops them and their admin "Download Access" UI is removed
-- in the same PR. Tier-narrowing a single file is now expressed as the
-- per-attachment container_contents.min_membership floor.
--
-- Dropped:
--   • community_resource_tiers      — the "green circle" per-resource tier allowlist (076)
--   • community_resources.min_tier_rank — the per-file download gate (012)
--
-- Other tables keep their own min_tier_rank (spaces, training, event materials) —
-- only the community_resources column is removed here.

DROP TABLE IF EXISTS public.community_resource_tiers;

ALTER TABLE public.community_resources
  DROP COLUMN IF EXISTS min_tier_rank;
