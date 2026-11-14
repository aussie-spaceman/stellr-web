-- S0-members-policies (multi-tenancy plan S0, "Database grants"): drop the
-- legacy members policies, fix the RLS helpers and the chat policy.
--
-- NOT APPLIED ANYWHERE when written. Proven only by CI's db job (baseline +
-- every timestamped migration, then pgTAP:
-- supabase/tests/database/s0_members_policies.test.sql). Production runs it
-- through the owner-approved Production migration Action, after a backup.
--
-- ── Inventory: every policy on public.members ────────────────────────────────
-- Read from supabase/baseline.sql and every timestamped migration after it
-- (none of which creates, alters or drops a policy on members).
--
--   policy               cmd     roles   USING / WITH CHECK                          verdict
--   members_admin_all    ALL     PUBLIC  jwt app_metadata.role = 'admin' / (same)    legacy: DROP
--   members_self_read    SELECT  PUBLIC  auth.uid()::text = clerk_user_id            legacy: DROP
--   members_self_update  UPDATE  PUBLIC  auth.uid()::text = clerk_user_id / (none)   legacy: DROP
--   tenant_isolation, tenant_isolation_guard                                         none on members
--
-- Why each is legacy:
--   * All three predate Clerk. They were written for Supabase Auth, where
--     auth.uid() is a uuid and admins carry app_metadata.role. Under Clerk
--     Third-Party Auth, `sub` is a Clerk user id (not a uuid), so auth.uid()
--     raises 22P02 on every authenticated read, and app_metadata is not how
--     this app marks admins (admin_duties / member_roles, read server-side).
--   * members_admin_all is FOR ALL TO PUBLIC (anon included) and trusts a
--     token claim for full read and write of every member row.
--   * members_self_update has no WITH CHECK: had it ever matched, a member
--     could rewrite any column of their own row (is_active, deleted_at,
--     clerk_user_id, event_role, the guardian and health fields).
--   * The app never reads members with a non-service-role client.
--     lib/supabase-browser.ts is the only browser client with a session, and
--     it is used only for Realtime on chat_messages and community_posts. Every
--     members read is server-side on service_role, which has BYPASSRLS. So the
--     self-read is not rewritten on the Clerk claim: nothing needs it.
--   * members is classified `identity` in lib/tenancy/registry.ts, so it has
--     no tenant_isolation / tenant_isolation_guard policy. Those policies on
--     the tenant tables (20261104200000_tenant_isolation_policies.sql and
--     later) are untouched; the pgTAP file checks they are still present.
--
-- After this migration members keeps RLS enabled and has one policy:
--   members_no_api_access  ALL  anon, authenticated  RESTRICTIVE  USING false / WITH CHECK false
-- A restrictive policy grants nothing on its own; it caps the API roles at
-- zero rows even if someone later adds a permissive policy for PUBLIC, and it
-- states the intent where the Security Advisor and the next reader will see
-- it (members stays off the "RLS enabled, no policy" list). The SECURITY
-- DEFINER helpers below run as their owner and are not affected by it.
--
-- ── The RLS helpers ──────────────────────────────────────────────────────────
-- can_read_chat_channel, can_read_space and survey_current_member_id are
-- SECURITY DEFINER, so they read members as their owner and never relied on
-- the dropped policies. They are re-created here to:
--   1. pin search_path to '' with every name schema-qualified. The old
--      `search_path TO 'public'` let an object in pg_temp or an earlier schema
--      shadow an unqualified table name inside a definer function.
--   2. close the membership oracle in the two two-argument helpers. They are
--      EXECUTE-able by `authenticated` (the policies need that) and took the
--      Clerk id as a free argument, so any signed-in member could call them
--      over the Data API (rpc) with someone else's Clerk id and learn which
--      channels and Spaces that person can read. When the request carries a
--      JWT `sub`, the argument must now equal it. The policies always pass the
--      caller's own sub, so they are unaffected; service_role and direct
--      database sessions carry no sub and keep the old behaviour.
--   3. (can_read_chat_channel) match the server gate, canAccessChannel in
--      lib/sessions.ts, branch by branch on the channel's kind:
--        coaching  the coachee or the host;
--        space     public.can_read_space on the channel's Space. This branch
--                  was missing, so Space chat never reached members over
--                  Realtime and fell back to the poll;
--        cohort    an active roster member, or the cohort's mentor who also
--                  holds session_hosts.can_mentor; and either way only while
--                  the cohort is active or was archived with 'keep_open'
--                  (lib/containers.ts containerAccessPersists, decision D1).
--      A deactivated or soft-deleted member still reads nothing (DB-N1).
--      The mentor's background clearance (isClearedForMinorContact) is derived
--      in TypeScript and is not mirrored here; see the PR for that gap.
--   can_read_space keeps its MEM-14 logic unchanged apart from 1 and 2.
--   survey_current_member_id keeps its logic unchanged apart from 1; it is
--   altered in place (its body is already fully qualified), not re-created.
-- Each stays SECURITY DEFINER, STABLE, EXECUTE-revoked from PUBLIC and anon,
-- and executable by authenticated (its policies call it) and service_role.
--
-- ── The chat policy ──────────────────────────────────────────────────────────
-- "members read own channel messages" on chat_messages is re-created to:
--   * hide soft-deleted messages (deleted_at IS NULL), as listMessages does;
--     the old policy let a member read a removed message's body over the API;
--   * read the caller's sub once per statement ((SELECT auth.jwt() ->> 'sub'))
--     instead of once per row.
-- It stays the only permissive policy on chat_messages that reaches an API
-- role, so a member reads exactly the rows can_read_chat_channel allows.

-- ── 1. members: drop the legacy policies, cap the API roles ──────────────────
DROP POLICY IF EXISTS members_admin_all ON public.members;
DROP POLICY IF EXISTS members_self_read ON public.members;
DROP POLICY IF EXISTS members_self_update ON public.members;

DROP POLICY IF EXISTS members_no_api_access ON public.members;
CREATE POLICY members_no_api_access ON public.members
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ── 2. can_read_space ────────────────────────────────────────────────────────
-- rls-helper: keep authenticated EXECUTE. SECURITY DEFINER (to avoid RLS
-- recursion) and called by the authenticated SELECT policies on
-- community_posts and community_comments, and by can_read_chat_channel's
-- space branch. Revoking authenticated would make those policies fail closed.
CREATE OR REPLACE FUNCTION public.can_read_space(p_space_id uuid, p_clerk_user_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.members m
    WHERE m.clerk_user_id = p_clerk_user_id
      -- A signed-in caller may ask only about themselves (no membership oracle).
      AND (NULLIF(auth.jwt() ->> 'sub', '') IS NULL OR auth.jwt() ->> 'sub' = p_clerk_user_id)
      -- A deactivated / deleted member reads nothing, even an open space.
      AND m.is_active = true
      AND m.deleted_at IS NULL
      -- An archived space is closed to everyone (getSpaceAccessById).
      AND NOT EXISTS (
        SELECT 1 FROM public.community_spaces s
        WHERE s.id = p_space_id AND s.is_archived = true
      )
      -- An active access-scope suspension outranks every positive grant.
      AND NOT EXISTS (
        SELECT 1 FROM public.community_space_suspensions sus
        WHERE sus.space_id = p_space_id
          AND sus.member_id = m.id
          AND sus.scope = 'access'
          AND (sus.expires_at IS NULL OR sus.expires_at > now())
      )
      AND (
        -- Open spaces are readable by any active, un-suspended member.
        EXISTS (SELECT 1 FROM public.community_spaces s WHERE s.id = p_space_id AND s.access_type = 'open')
        -- Active roster membership (any role).
        OR EXISTS (
          SELECT 1 FROM public.community_space_members sm
          WHERE sm.space_id = p_space_id AND sm.status = 'active' AND sm.member_id = m.id
        )
        -- Membership-tier auto-grant, but not on event-linked spaces (MEM-14).
        OR (
          NOT EXISTS (
            SELECT 1 FROM public.community_space_sources src
            WHERE src.space_id = p_space_id AND src.object_type = 'event'
          )
          AND EXISTS (
            SELECT 1 FROM public.community_space_tiers st
            JOIN public.member_memberships mm ON mm.tier_id = st.tier_id
            WHERE st.space_id = p_space_id AND mm.member_id = m.id
              AND mm.renewal_status = 'active'
              AND (mm.expires_at IS NULL OR mm.expires_at >= now()::date)
          )
        )
      )
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.can_read_space(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_space(uuid, text) TO authenticated, service_role;

-- ── 3. can_read_chat_channel ─────────────────────────────────────────────────
-- rls-helper: keep authenticated EXECUTE. SECURITY DEFINER (to avoid RLS
-- recursion) and called by the authenticated SELECT policy on chat_messages,
-- which Realtime evaluates for every chat subscriber. Revoking authenticated
-- would make that policy fail closed and stop live chat.
CREATE OR REPLACE FUNCTION public.can_read_chat_channel(_channel_id uuid, _clerk_sub text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.chat_channels ch
    -- Resolve the caller's member row once; a deactivated or soft-deleted
    -- member matches nothing (DB-N1).
    JOIN public.members m
      ON m.clerk_user_id = _clerk_sub
     AND m.is_active = true
     AND m.deleted_at IS NULL
    WHERE ch.id = _channel_id
      -- A signed-in caller may ask only about themselves (no membership oracle).
      AND (NULLIF(auth.jwt() ->> 'sub', '') IS NULL OR auth.jwt() ->> 'sub' = _clerk_sub)
      AND (
        -- Coaching: the coachee or the host.
        (ch.kind = 'coaching' AND (ch.member_id = m.id OR ch.host_member_id = m.id))
        -- Space chat mirrors Space read access.
        OR (ch.kind = 'space' AND ch.space_id IS NOT NULL
            AND public.can_read_space(ch.space_id, _clerk_sub))
        -- Cohort: only while the cohort is active, or archived with keep_open.
        OR (ch.kind = 'cohort' AND ch.cohort_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM public.mentoring_cohorts arch
              WHERE arch.id = ch.cohort_id
                AND arch.lifecycle = 'archived'
                AND NOT EXISTS (
                  SELECT 1 FROM public.content_persistence cp
                  WHERE cp.target_type = 'container'
                    AND cp.target_ref = ch.cohort_id::text
                    AND cp.policy = 'keep_open'
                )
            )
            AND (
              -- an active roster member
              EXISTS (
                SELECT 1 FROM public.cohort_members cm
                WHERE cm.cohort_id = ch.cohort_id
                  AND cm.member_id = m.id
                  AND cm.status = 'active'
              )
              -- the cohort's mentor, who still holds the mentor capability
              OR EXISTS (
                SELECT 1 FROM public.mentoring_cohorts mc
                JOIN public.session_hosts sh ON sh.member_id = m.id AND sh.can_mentor = true
                WHERE mc.id = ch.cohort_id AND mc.mentor_member_id = m.id
              )
            ))
      )
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.can_read_chat_channel(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_chat_channel(uuid, text) TO authenticated, service_role;

-- ── 4. survey_current_member_id ──────────────────────────────────────────────
-- rls-helper: keep authenticated EXECUTE. SECURITY DEFINER so the survey
-- self-read policies on survey_responses / survey_answers need no SELECT on
-- members; revoking authenticated would make them fail closed. Its body
-- (20261002235036_post_event_survey.sql) already names public.members and
-- auth.jwt() in full, so only the search_path changes: ALTER, not CREATE OR
-- REPLACE. Its grants stay exactly as 20261102220634_seal_definer_functions_db_n3
-- left them (PUBLIC and anon revoked; authenticated and service_role granted),
-- so that migration stays the one that seals it.
ALTER FUNCTION public.survey_current_member_id() SET search_path = '';

-- ── 5. The chat policy ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "members read own channel messages" ON public.chat_messages;
CREATE POLICY "members read own channel messages" ON public.chat_messages
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.can_read_chat_channel(channel_id, (SELECT auth.jwt() ->> 'sub'))
  );
