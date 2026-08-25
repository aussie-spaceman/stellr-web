-- 140 — Remove the Staff, Moderators' and Teachers' role Spaces.
--
-- Migration 125 seeded one role Space per adult web-app role. Three of them are
-- not wanted: staff, moderator and teacher. Teachers reach the community through
-- General and the Educator Tier Space instead, so the Teachers' Room duplicated
-- access they already had.
--
-- Deleting here rather than only in prod keeps a rebuilt database in step: 125's
-- seed is ON CONFLICT DO NOTHING, so without this it would recreate all three.
--
-- Every child row goes with the Space (all FKs to community_spaces are ON DELETE
-- CASCADE; community_resources.space_id is SET NULL). Verified empty before
-- running: 0 posts, 0 announcements, 0 resources, 0 chat channels, 0 roster rows,
-- 0 invites — one 'general' channel each, and their community_space_roles grant.
--
-- The remaining role Spaces (Coaches', Mentors', Volunteers') are untouched.

DELETE FROM public.community_spaces
WHERE slug IN ('role-staff', 'role-moderator', 'role-teacher');
