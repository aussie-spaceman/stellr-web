-- Migration 012: Community module foundation (Component 3 — Members-Only Portal)
--
-- Creates the schema for spaces, posts, threaded comments, reactions, resources,
-- announcements, member directory opt-in, notifications, and a moderation queue.
--
-- Conventions follow the rest of the codebase:
--   * uuid PKs via gen_random_uuid()
--   * authorship references public.members(id) (members are linked to Clerk via clerk_user_id)
--   * RLS enabled with a "service role full access" policy — all access is gated in the
--     server layer (Clerk auth + supabaseServer() service-role client), NOT via JWT RLS.
--
-- Tier gating (FR-COM-03 / FR-COM-08): content carries `min_tier_rank` (smallint).
--   0 = open to every authenticated member, including free tiers
--   1 = requires any paid tier (membership_tiers.is_free = false)
-- The free-vs-paid split is what the FRs call for; the rank column leaves room for
-- finer-grained tiers later without a schema change.

-- ─── community_spaces ──────────────────────────────────────────────────────
-- Topic channels (FR-COM-02): e.g. by discipline, competition, or general.
CREATE TABLE IF NOT EXISTS public.community_spaces (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text NOT NULL UNIQUE,
  name           text NOT NULL,
  description    text,
  icon           text,
  min_tier_rank  smallint NOT NULL DEFAULT 0,
  display_order  integer NOT NULL DEFAULT 0,
  is_archived    boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_spaces_display_order_idx
  ON public.community_spaces(display_order);

ALTER TABLE public.community_spaces ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access community_spaces"
    ON public.community_spaces FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── community_posts ───────────────────────────────────────────────────────
-- Discussion threads and admin announcements (FR-COM-02, FR-COM-05).
-- body_json holds TipTap document JSON; body_text is a plain-text projection
-- maintained by the app for full-text search (FR-COM-09).
CREATE TABLE IF NOT EXISTS public.community_posts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id         uuid NOT NULL REFERENCES public.community_spaces(id) ON DELETE CASCADE,
  author_member_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  title            text NOT NULL,
  body_json        jsonb,
  body_text        text,
  is_announcement  boolean NOT NULL DEFAULT false,
  is_pinned        boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'published'
                     CHECK (status IN ('published', 'hidden', 'deleted')),
  comment_count    integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_posts_space_id_idx
  ON public.community_posts(space_id, created_at DESC);
CREATE INDEX IF NOT EXISTS community_posts_author_idx
  ON public.community_posts(author_member_id);
CREATE INDEX IF NOT EXISTS community_posts_announcement_idx
  ON public.community_posts(is_announcement) WHERE is_announcement = true;

-- Full-text search across title + body (FR-COM-09)
CREATE INDEX IF NOT EXISTS community_posts_search_idx
  ON public.community_posts
  USING gin (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body_text, '')));

ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access community_posts"
    ON public.community_posts FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── community_comments ────────────────────────────────────────────────────
-- Threaded replies (FR-COM-02). parent_comment_id enables one level of nesting.
CREATE TABLE IF NOT EXISTS public.community_comments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id           uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  parent_comment_id uuid REFERENCES public.community_comments(id) ON DELETE CASCADE,
  author_member_id  uuid REFERENCES public.members(id) ON DELETE SET NULL,
  body_json         jsonb,
  body_text         text,
  status            text NOT NULL DEFAULT 'published'
                      CHECK (status IN ('published', 'hidden', 'deleted')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_comments_post_id_idx
  ON public.community_comments(post_id, created_at);
CREATE INDEX IF NOT EXISTS community_comments_parent_idx
  ON public.community_comments(parent_comment_id);

ALTER TABLE public.community_comments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access community_comments"
    ON public.community_comments FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── community_reactions ───────────────────────────────────────────────────
-- Emoji reactions on posts or comments. One row per member+target+emoji.
CREATE TABLE IF NOT EXISTS public.community_reactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type      text NOT NULL CHECK (target_type IN ('post', 'comment')),
  target_id        uuid NOT NULL,
  author_member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  emoji            text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_type, target_id, author_member_id, emoji)
);

CREATE INDEX IF NOT EXISTS community_reactions_target_idx
  ON public.community_reactions(target_type, target_id);

ALTER TABLE public.community_reactions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access community_reactions"
    ON public.community_reactions FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── community_resources ───────────────────────────────────────────────────
-- Resource library (FR-COM-03): documents, videos, past papers, study guides.
-- storage_path points at a private Supabase Storage object; downloads are served
-- via short-lived signed URLs only after a server-side tier check.
CREATE TABLE IF NOT EXISTS public.community_resources (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id         uuid REFERENCES public.community_spaces(id) ON DELETE SET NULL,
  title            text NOT NULL,
  description      text,
  storage_path     text NOT NULL,
  file_type        text,
  file_size_bytes  bigint,
  min_tier_rank    smallint NOT NULL DEFAULT 0,  -- visible to all; gate DOWNLOAD on paid
  uploaded_by      uuid REFERENCES public.members(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_resources_space_id_idx
  ON public.community_resources(space_id);
CREATE INDEX IF NOT EXISTS community_resources_search_idx
  ON public.community_resources
  USING gin (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '')));

ALTER TABLE public.community_resources ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access community_resources"
    ON public.community_resources FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── community_notifications ───────────────────────────────────────────────
-- In-app + email notifications (FR-COM-06): replies, mentions, new resources,
-- announcements. Email delivery is fired by the app on insert (Resend).
CREATE TABLE IF NOT EXISTS public.community_notifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  actor_member_id  uuid REFERENCES public.members(id) ON DELETE SET NULL,
  type             text NOT NULL
                     CHECK (type IN ('reply', 'mention', 'announcement', 'resource')),
  reference_type   text,            -- 'post' | 'comment' | 'resource'
  reference_id     uuid,
  body             text,
  is_read          boolean NOT NULL DEFAULT false,
  emailed_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_notifications_recipient_idx
  ON public.community_notifications(recipient_member_id, is_read, created_at DESC);

ALTER TABLE public.community_notifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access community_notifications"
    ON public.community_notifications FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── community_flags ───────────────────────────────────────────────────────
-- Moderation queue (FR-COM-07 + NFR): members flag content; admins resolve from
-- the admin dashboard.
CREATE TABLE IF NOT EXISTS public.community_flags (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type      text NOT NULL CHECK (content_type IN ('post', 'comment')),
  content_id        uuid NOT NULL,
  flagged_by        uuid REFERENCES public.members(id) ON DELETE SET NULL,
  reason            text,
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'resolved', 'dismissed')),
  resolved_by       uuid REFERENCES public.members(id) ON DELETE SET NULL,
  resolved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_flags_status_idx
  ON public.community_flags(status, created_at DESC);

ALTER TABLE public.community_flags ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access community_flags"
    ON public.community_flags FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── member_directory_prefs ────────────────────────────────────────────────
-- Opt-in member directory (FR-COM-04). One row per member; absence = not visible.
CREATE TABLE IF NOT EXISTS public.member_directory_prefs (
  member_id     uuid PRIMARY KEY REFERENCES public.members(id) ON DELETE CASCADE,
  is_visible    boolean NOT NULL DEFAULT false,
  show_school   boolean NOT NULL DEFAULT true,
  show_region   boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.member_directory_prefs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access member_directory_prefs"
    ON public.member_directory_prefs FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Seed starter spaces (FR-COM-02) ───────────────────────────────────────
INSERT INTO public.community_spaces (slug, name, description, min_tier_rank, display_order)
VALUES
  ('general',      'General',      'Open discussion for all members.',                 0, 0),
  ('competitions', 'Competitions', 'Talk strategy, results, and upcoming events.',      0, 1),
  ('study-hall',   'Study Hall',   'Resources and prep — paid members can download.',   0, 2)
ON CONFLICT (slug) DO NOTHING;
