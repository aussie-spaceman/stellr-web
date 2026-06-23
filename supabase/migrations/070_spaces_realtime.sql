-- Migration 070: Spaces realtime — live channel feeds over the existing seam
--
-- Mirrors migration 047 (chat realtime). The Clerk-token browser client
-- (lib/supabase-browser.ts) subscribes to community_posts / community_comments so
-- new posts and replies stream into the open channel feed live. An authenticated
-- SELECT policy gated by can_read_space() ensures a member only receives changes
-- for spaces they can actually access; when Clerk↔Supabase third-party auth is not
-- configured the token is rejected and the feed falls back to polling.
--
-- All community_* "service role full access" policies were already re-scoped to
-- service_role in migration 049, so these new authenticated SELECT policies are the
-- ONLY non-service path to this data and must be written tightly.

-- ─── can_read_space(space_id, clerk_user_id) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_read_space(p_space_id uuid, p_clerk_user_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    -- Open spaces are readable by any authenticated member.
    EXISTS (SELECT 1 FROM community_spaces s WHERE s.id = p_space_id AND s.access_type = 'open')
    -- Active roster membership (any role) grants access.
    OR EXISTS (
      SELECT 1 FROM community_space_members sm
      JOIN members m ON m.id = sm.member_id
      WHERE sm.space_id = p_space_id AND sm.status = 'active'
        AND m.clerk_user_id = p_clerk_user_id
    )
    -- Membership-tier auto-grant (private / secret).
    OR EXISTS (
      SELECT 1 FROM community_space_tiers st
      JOIN member_memberships mm ON mm.tier_id = st.tier_id
      JOIN members m ON m.id = mm.member_id
      WHERE st.space_id = p_space_id AND m.clerk_user_id = p_clerk_user_id
        AND mm.renewal_status = 'active'
        AND (mm.expires_at IS NULL OR mm.expires_at >= now()::date)
    );
$$;

-- ─── Posts: read published posts in accessible spaces ───────────────────────
DO $$ BEGIN
  CREATE POLICY "members read accessible space posts"
    ON public.community_posts FOR SELECT TO authenticated
    USING (
      status = 'published'
      AND channel_id IS NOT NULL
      AND public.can_read_space(
        (SELECT c.space_id FROM public.community_channels c WHERE c.id = community_posts.channel_id),
        (auth.jwt() ->> 'sub')
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Comments: same gate, space resolved via post → channel ─────────────────
DO $$ BEGIN
  CREATE POLICY "members read accessible space comments"
    ON public.community_comments FOR SELECT TO authenticated
    USING (
      status = 'published'
      AND public.can_read_space(
        (SELECT c.space_id FROM public.community_channels c
           JOIN public.community_posts p ON p.channel_id = c.id
          WHERE p.id = community_comments.post_id),
        (auth.jwt() ->> 'sub')
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Publish to the realtime stream the browser client subscribes to ────────
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.community_posts;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.community_comments;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
