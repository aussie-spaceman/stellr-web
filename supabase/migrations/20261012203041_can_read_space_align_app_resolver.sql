-- deep review MEM-14: bring the Realtime/PostgREST RLS helper can_read_space the
-- rest of the way in line with the app's server-side access resolver
-- (lib/spaces.ts). DB-2 (20261009220613) already taught it to honour
-- deactivation and access-scope suspensions. Two divergences remained, both of
-- which let the browser client read posts the server would refuse:
--
--   (a) Event-linked spaces: a Space linked to an Event owns its membership from
--       that Event's roster, and the app DELIBERATELY suppresses tier (and role)
--       auto-grants on it (lib/spaces.ts `isEventLinked` → assignedTierIds = []).
--       The helper still honoured community_space_tiers on those spaces, so a
--       tier holder who never registered for the event could read its posts over
--       Realtime. Suppress the tier grant when the space is event-linked.
--
--   (b) Archived spaces: getSpaceAccessById returns null for an archived space
--       (community_spaces.is_archived), i.e. no access. The helper ignored the
--       flag. Deny reads on an archived space.
--
-- Open-space reads and active-roster reads are unchanged (an open or roster
-- member still reads an event-linked space, exactly as the app allows). This only
-- tightens the tier path and adds the archived guard, so it can never grant more
-- than before.
--
-- Live because Supabase Third-Party Auth for Clerk is enabled (owner, 9 Oct 2026).
--
-- rls-helper: keep authenticated EXECUTE. A SECURITY DEFINER RLS helper (so it
-- avoids RLS recursion) called inside the authenticated SELECT policies on the
-- community spaces — revoking EXECUTE from `authenticated` would make those
-- policies fail closed and break space reads. anon's grant was revoked in 118.
-- This annotation is the allowlist escape hatch recognised by lint:migrations
-- (scripts/check-migration-security.mjs).

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
      -- MEM-14 (b): an archived space is closed to everyone (matches
      -- getSpaceAccessById, which returns null for is_archived).
      AND NOT EXISTS (
        SELECT 1 FROM community_spaces s
        WHERE s.id = p_space_id AND s.is_archived = true
      )
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
        -- Membership-tier auto-grant (private / secret) — but NOT on event-linked
        -- spaces, whose access the linked Event owns (MEM-14 (a); mirrors the
        -- app's isEventLinked suppression).
        OR (
          NOT EXISTS (
            SELECT 1 FROM community_space_sources src
            WHERE src.space_id = p_space_id AND src.object_type = 'event'
          )
          AND EXISTS (
            SELECT 1 FROM community_space_tiers st
            JOIN member_memberships mm ON mm.tier_id = st.tier_id
            WHERE st.space_id = p_space_id AND mm.member_id = m.id
              AND mm.renewal_status = 'active'
              AND (mm.expires_at IS NULL OR mm.expires_at >= now()::date)
          )
        )
      )
  );
$function$;
