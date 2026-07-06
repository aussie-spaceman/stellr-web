-- Rename the Space role value `mentor` → `moderator`.
--
-- Spaces have three permission types: Stellr Admin, Moderator, Member. The stored
-- roster value was historically 'mentor'; align the data with the UI. This is the
-- SPACE role only (community_space_members / community_space_invites) — the
-- separate member_roles catalogue (which has its own distinct 'mentor' and
-- 'moderator' entries) is unaffected.

-- community_space_members.role ───────────────────────────────────────────────
ALTER TABLE public.community_space_members
  DROP CONSTRAINT IF EXISTS community_space_members_role_check;

UPDATE public.community_space_members SET role = 'moderator' WHERE role = 'mentor';

ALTER TABLE public.community_space_members
  ADD CONSTRAINT community_space_members_role_check
  CHECK (role IN ('admin', 'moderator', 'member'));

-- community_space_invites.role ────────────────────────────────────────────────
ALTER TABLE public.community_space_invites
  DROP CONSTRAINT IF EXISTS community_space_invites_role_check;

UPDATE public.community_space_invites SET role = 'moderator' WHERE role = 'mentor';

ALTER TABLE public.community_space_invites
  ADD CONSTRAINT community_space_invites_role_check
  CHECK (role IN ('moderator', 'member'));
