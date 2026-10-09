-- deep review DB-2: the Realtime RLS helper can_read_space granted read access on
-- an open space, an active roster row, or a tier auto-grant — but NEVER consulted
-- community_space_suspensions (scope 'access'), members.is_active or
-- members.deleted_at. So a member suspended from a space for a safeguarding
-- concern, or a deactivated member with a surviving Clerk login, kept reading the
-- space (which may contain minors' posts) directly over the browser client /
-- Realtime. The server gate (lib/spaces.ts resolveSpaceAccess + loadSpaceSuspensions)
-- already denies these; this brings the RLS helper in line.
--
-- Live because Supabase Third-Party Auth for Clerk is enabled (owner, 9 Oct 2026).

CREATE OR REPLACE FUNCTION public.can_read_space(p_space_id uuid, p_clerk_user_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM members m
    WHERE m.clerk_user_id = p_clerk_user_id
      -- A deactivated / deleted member reads nothing, even an open space.
      AND m.is_active = true
      AND m.deleted_at IS NULL
      -- An active access-scope suspension outranks every positive grant
      -- (matches resolveSpaceAccess's `revoked`). expires_at NULL or future = active.
      AND NOT EXISTS (
        SELECT 1 FROM community_space_suspensions sus
        WHERE sus.space_id = p_space_id
          AND sus.member_id = m.id
          AND sus.scope = 'access'
          AND (sus.expires_at IS NULL OR sus.expires_at > now())
      )
      AND (
        -- Open spaces are readable by any active, un-suspended member.
        EXISTS (SELECT 1 FROM community_spaces s WHERE s.id = p_space_id AND s.access_type = 'open')
        -- Active roster membership (any role).
        OR EXISTS (
          SELECT 1 FROM community_space_members sm
          WHERE sm.space_id = p_space_id AND sm.status = 'active' AND sm.member_id = m.id
        )
        -- Membership-tier auto-grant (private / secret).
        OR EXISTS (
          SELECT 1 FROM community_space_tiers st
          JOIN member_memberships mm ON mm.tier_id = st.tier_id
          WHERE st.space_id = p_space_id AND mm.member_id = m.id
            AND mm.renewal_status = 'active'
            AND (mm.expires_at IS NULL OR mm.expires_at >= now()::date)
        )
      )
  );
$function$;
