-- Migration 047: scoped chat RLS + Realtime (access-model #11c — true push chat).
--
-- Lets a Clerk-authenticated browser client RECEIVE Realtime inserts for channels
-- it belongs to, without exposing chat to anon. The server keeps using the
-- service-role key (which bypasses RLS), so server access is unaffected.
--
-- Requires Supabase "Third-Party Auth" configured for Clerk so that
-- auth.jwt() ->> 'sub' resolves to the Clerk user id (= members.clerk_user_id).
-- Until that dashboard step is done, the browser simply receives no events and
-- the existing ~8s polling continues — no regression.

-- 1. Membership check as SECURITY DEFINER so the policy doesn't depend on RLS of
--    the referenced tables (cohort_members / members / chat_channels).
CREATE OR REPLACE FUNCTION public.can_read_chat_channel(_channel_id uuid, _clerk_sub text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_channels ch
    WHERE ch.id = _channel_id AND (
      EXISTS (
        SELECT 1 FROM public.cohort_members cm
        JOIN public.members m ON m.id = cm.member_id
        WHERE cm.cohort_id = ch.cohort_id AND m.clerk_user_id = _clerk_sub
      )
      OR EXISTS (SELECT 1 FROM public.members m WHERE m.id = ch.member_id AND m.clerk_user_id = _clerk_sub)
      OR EXISTS (SELECT 1 FROM public.members m WHERE m.id = ch.host_member_id AND m.clerk_user_id = _clerk_sub)
    )
  );
$$;
GRANT EXECUTE ON FUNCTION public.can_read_chat_channel(uuid, text) TO authenticated;

-- 2. Tighten chat_messages: drop the permissive public policy (it let ANY role,
--    incl. anon, read — which would leak over Realtime), keep full access for the
--    service role, and let authenticated members read only their channels.
DROP POLICY IF EXISTS "service role full access chat_messages" ON public.chat_messages;

DO $$ BEGIN
  CREATE POLICY "service_role all chat_messages" ON public.chat_messages
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "members read own channel messages" ON public.chat_messages
    FOR SELECT TO authenticated
    USING (public.can_read_chat_channel(channel_id, (auth.jwt() ->> 'sub')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Publish chat_messages for Realtime (idempotent).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
  END IF;
END $$;
