-- 128_remove_educator_commons.sql
-- Full teardown of the seeded "Educator Commons" open Space.
--
-- The Educator Commons space (seeded in migration 120) was a Claude Design
-- hallucination — a generic open space with placeholder workshop-slide resources
-- and a group chat that never mapped to real product structure. Campaigns surface
-- their materials/workspace directly, so this space and everything hanging off it
-- is removed here.
--
-- All child tables reference community_spaces(id) ON DELETE CASCADE (channels,
-- resources, members, space_sources, pending invites, posts/messages), so a single
-- delete of the space row tears down the whole subtree. Idempotent: a no-op if the
-- space was already removed.

DELETE FROM public.community_spaces
WHERE slug = 'educator-commons';
