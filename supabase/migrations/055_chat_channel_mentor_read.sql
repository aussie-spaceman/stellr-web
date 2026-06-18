-- Fix realtime chat authorization (Wave 0): can_read_chat_channel never granted
-- the cohort MENTOR access (mentors live on mentoring_cohorts.mentor_member_id,
-- not cohort_members), so their Realtime subscription was denied and chat fell
-- back to the 8s poll. Also scope the roster branch to active members so an
-- invited-but-not-accepted member can't read ahead of acceptance — matching the
-- server-side canAccessChannel() logic in lib/sessions.ts.
CREATE OR REPLACE FUNCTION public.can_read_chat_channel(_channel_id uuid, _clerk_sub text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_channels ch
    WHERE ch.id = _channel_id AND (
      -- cohort roster (active members only)
      EXISTS (
        SELECT 1 FROM public.cohort_members cm
        JOIN public.members m ON m.id = cm.member_id
        WHERE cm.cohort_id = ch.cohort_id
          AND cm.status = 'active'
          AND m.clerk_user_id = _clerk_sub
      )
      -- cohort mentor
      OR EXISTS (
        SELECT 1 FROM public.mentoring_cohorts mc
        JOIN public.members m ON m.id = mc.mentor_member_id
        WHERE mc.id = ch.cohort_id AND m.clerk_user_id = _clerk_sub
      )
      -- coaching coachee
      OR EXISTS (SELECT 1 FROM public.members m WHERE m.id = ch.member_id AND m.clerk_user_id = _clerk_sub)
      -- coaching host
      OR EXISTS (SELECT 1 FROM public.members m WHERE m.id = ch.host_member_id AND m.clerk_user_id = _clerk_sub)
    )
  );
$function$;
