-- deep review DB-N1: the DB-2 fix (20261009220613) taught can_read_space to deny a
-- deactivated or soft-deleted member, but its sibling Realtime helper
-- can_read_chat_channel was left untouched. That helper's roster branch checked
-- only cohort_members.status + clerk_user_id, and the mentor / coaching-coachee /
-- coaching-host branches matched purely on member id + clerk_user_id — none
-- consulted members.is_active or members.deleted_at. The admin member form can set
-- is_active = false as a plain field WITHOUT nulling clerk_user_id (only a full
-- soft-delete nulls Clerk), so deactivating a member for a safeguarding concern —
-- the fast path, short of a full delete — left that adult's Clerk login live and
-- their browser Supabase client still passing this helper, keeping a live Realtime
-- read of cohort and coaching chat (exactly where adult mentors talk to minors).
--
-- Require the matched members row to be is_active = true AND deleted_at IS NULL in
-- EVERY branch — resolve the caller's member once (as can_read_space does) and key
-- the relationship checks off that row. The server gate lib/sessions.ts
-- canAccessChannel gets the same guard; the browser/Realtime path is gated solely
-- by this RLS helper.
--
-- Live because Supabase Third-Party Auth for Clerk is enabled (owner, 9 Oct 2026).
-- CREATE OR REPLACE preserves 047's `GRANT EXECUTE ... TO authenticated` — this is
-- an RLS helper and MUST keep the authenticated EXECUTE grant to work over Realtime.

CREATE OR REPLACE FUNCTION public.can_read_chat_channel(_channel_id uuid, _clerk_sub text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.chat_channels ch
    -- Resolve the caller's member row once, and refuse it outright when the member
    -- is deactivated or soft-deleted (mirrors can_read_space). A soft-delete also
    -- nulls clerk_user_id, so that case already fails the join; this additionally
    -- catches the is_active = false "deactivated but Clerk login kept" path.
    JOIN public.members m
      ON m.clerk_user_id = _clerk_sub
     AND m.is_active = true
     AND m.deleted_at IS NULL
    WHERE ch.id = _channel_id AND (
      -- cohort roster (active members only)
      EXISTS (
        SELECT 1 FROM public.cohort_members cm
        WHERE cm.cohort_id = ch.cohort_id
          AND cm.status = 'active'
          AND cm.member_id = m.id
      )
      -- cohort mentor
      OR EXISTS (
        SELECT 1 FROM public.mentoring_cohorts mc
        WHERE mc.id = ch.cohort_id AND mc.mentor_member_id = m.id
      )
      -- coaching coachee
      OR ch.member_id = m.id
      -- coaching host
      OR ch.host_member_id = m.id
    )
  );
$function$;
