-- Migration 069: Spaces — channels, access types, per-space rosters/roles, invites
--
-- Extends the community module (migration 012) into the Circle.so-style "Spaces"
-- design (design_handoff_spaces). Each space becomes a CONTAINER OF CHANNELS with:
--   * explicit Open / Private / Secret access (replacing bare min_tier_rank)
--   * membership-tier assignment (auto-grant) + admin invites with accept/decline
--   * per-space member rosters with Admin / Mentor / Member roles
--   * space-scoped announcements, resource & training assignment
--   * file flagging (moderation) on resources as well as posts/comments
--
-- All changes are ADDITIVE and BACKFILLED, so the existing flat spaces keep
-- working: every existing space gains a default "# general" channel and its posts
-- are pointed at it. Access is gated entirely in the server layer; per the rescope
-- in migration 049, every new table's RLS policy is scoped TO service_role.

-- ─── community_spaces: access model + posting/upload policy + theme ──────────
ALTER TABLE public.community_spaces
  ADD COLUMN IF NOT EXISTS access_type text NOT NULL DEFAULT 'open'
    CHECK (access_type IN ('open', 'private', 'secret')),
  ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'space'
    CHECK (theme IN ('space', 'enviro', 'campaign', 'college')),
  ADD COLUMN IF NOT EXISTS posting_policy text NOT NULL DEFAULT 'all'
    CHECK (posting_policy IN ('all', 'moderators')),
  ADD COLUMN IF NOT EXISTS allow_member_uploads boolean NOT NULL DEFAULT true;

-- Backfill access_type from the legacy rank: paid-gated spaces become Private,
-- free-for-all spaces stay Open. (Secret is opt-in only, set by an admin later.)
UPDATE public.community_spaces
  SET access_type = 'private'
  WHERE min_tier_rank > 0 AND access_type = 'open';

-- ─── community_space_tiers: membership tiers that auto-grant space access ────
-- A Private/Secret space lists the tiers whose holders gain access automatically.
CREATE TABLE IF NOT EXISTS public.community_space_tiers (
  space_id uuid NOT NULL REFERENCES public.community_spaces(id) ON DELETE CASCADE,
  tier_id  uuid NOT NULL REFERENCES public.membership_tiers(id) ON DELETE CASCADE,
  PRIMARY KEY (space_id, tier_id)
);

ALTER TABLE public.community_space_tiers ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access community_space_tiers"
    ON public.community_space_tiers FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── community_channels: channels within a space (FR Spaces channel rail) ────
CREATE TABLE IF NOT EXISTS public.community_channels (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id      uuid NOT NULL REFERENCES public.community_spaces(id) ON DELETE CASCADE,
  slug          text NOT NULL,
  name          text NOT NULL,
  description   text,
  display_order integer NOT NULL DEFAULT 0,
  is_archived   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, slug)
);

CREATE INDEX IF NOT EXISTS community_channels_space_idx
  ON public.community_channels(space_id, display_order);

ALTER TABLE public.community_channels ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access community_channels"
    ON public.community_channels FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── community_posts: now belong to a channel ───────────────────────────────
ALTER TABLE public.community_posts
  ADD COLUMN IF NOT EXISTS channel_id uuid
    REFERENCES public.community_channels(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS community_posts_channel_idx
  ON public.community_posts(channel_id, created_at DESC);

-- Backfill: give every space a default "general" channel, then attach its posts.
-- NOTE: 'general' / 'resources' / 'training' / 'announcements' / 'members' are
-- RESERVED channel slugs (the in-space nav uses them as section keys).
INSERT INTO public.community_channels (space_id, slug, name, display_order)
  SELECT id, 'general', 'General', 0 FROM public.community_spaces
  ON CONFLICT (space_id, slug) DO NOTHING;

UPDATE public.community_posts p
  SET channel_id = c.id
  FROM public.community_channels c
  WHERE c.space_id = p.space_id AND c.slug = 'general' AND p.channel_id IS NULL;

-- ─── community_space_members: roster, roles, invites ────────────────────────
-- One row per (space, member). status='invited' is a pending admin invite the
-- member accepts (→ 'active') or declines (row deleted). role mirrors the
-- Mentoring product: admin / mentor / member (NO "staff"/"moderator" label).
CREATE TABLE IF NOT EXISTS public.community_space_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id    uuid NOT NULL REFERENCES public.community_spaces(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'mentor', 'member')),
  status      text NOT NULL DEFAULT 'active'  CHECK (status IN ('invited', 'active')),
  invited_by  uuid REFERENCES public.members(id) ON DELETE SET NULL,
  invited_at  timestamptz,
  accepted_at timestamptz,
  added_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, member_id)
);

CREATE INDEX IF NOT EXISTS community_space_members_member_idx
  ON public.community_space_members(member_id, status);
CREATE INDEX IF NOT EXISTS community_space_members_space_idx
  ON public.community_space_members(space_id, role);

ALTER TABLE public.community_space_members ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access community_space_members"
    ON public.community_space_members FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── community_resources: mark chat-originated files ────────────────────────
-- Files attached to a post auto-save into the space's Resources, flagged
-- from_chat=true and linked back to the originating post.
ALTER TABLE public.community_resources
  ADD COLUMN IF NOT EXISTS from_chat boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_post_id uuid
    REFERENCES public.community_posts(id) ON DELETE SET NULL;

-- ─── community_space_training: courses assigned to a space ──────────────────
CREATE TABLE IF NOT EXISTS public.community_space_training (
  space_id           uuid NOT NULL REFERENCES public.community_spaces(id) ON DELETE CASCADE,
  training_module_id uuid NOT NULL REFERENCES public.training_modules(id) ON DELETE CASCADE,
  is_mandatory       boolean NOT NULL DEFAULT false,
  display_order      integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, training_module_id)
);

ALTER TABLE public.community_space_training ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access community_space_training"
    ON public.community_space_training FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── community_announcements: space-scoped read-only announcements ──────────
-- Separate from channel-pinned announcement posts: these power the space's
-- Announcements section and the admin Announcements config tab.
CREATE TABLE IF NOT EXISTS public.community_announcements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id         uuid NOT NULL REFERENCES public.community_spaces(id) ON DELETE CASCADE,
  author_member_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  title            text NOT NULL,
  body             text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_announcements_space_idx
  ON public.community_announcements(space_id, created_at DESC);

ALTER TABLE public.community_announcements ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access community_announcements"
    ON public.community_announcements FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── community_flags: allow flagging resources (members + teachers) ─────────
ALTER TABLE public.community_flags DROP CONSTRAINT IF EXISTS community_flags_content_type_check;
ALTER TABLE public.community_flags
  ADD CONSTRAINT community_flags_content_type_check
  CHECK (content_type IN ('post', 'comment', 'resource'));
