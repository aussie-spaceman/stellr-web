-- Migration 049: re-scope the "service role full access" policies from public -> service_role.
--
-- BACKGROUND
-- ~54 public tables have RLS enabled but their `"service role full access <t>"`
-- policy was created as `FOR ALL USING(true) WITH CHECK(true)` with NO role clause,
-- which defaults to PUBLIC. Because `anon`/`authenticated` also hold table grants,
-- those tables are fully readable AND writable with the public anon key — despite
-- RLS being "enabled". The Supabase linter does not flag this (RLS is technically on),
-- so it was a silent hole. Affected tables include participants, registrations,
-- member_allergies, member_ethnicities, member_activity_log, deletion_archive/requests,
-- account_credits, email_campaign_*, and all community_*/training_*/session_* tables.
--
-- WHY THIS IS SAFE (audited 2026-06-16)
--   * All server code uses supabaseServer() = SUPABASE_SERVICE_ROLE_KEY, which has
--     BYPASSRLS — it ignores policies entirely, so server behaviour is unchanged.
--   * The only browser/authenticated Supabase client (lib/supabase-browser.ts,
--     Clerk-token) is used solely by components/community/ChatPanel.tsx for Realtime
--     on chat_messages, which has its OWN dedicated `{authenticated}` SELECT policy
--     (migration 047) — it does not depend on these "service role full access" policies.
--   * The anon `supabase` export in lib/supabase.ts is unused.
--
-- After this migration: service_role keeps full access; anon/authenticated have no
-- applicable policy on these tables and are denied. Tables that ALSO carry a
-- properly-scoped authenticated policy (e.g. chat_messages, members) keep it.
--
-- Idempotent: only touches policies still scoped to public; safe to re-run.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname LIKE 'service role full access %'
      AND 'public' = ANY (roles)
  LOOP
    EXECUTE format(
      'ALTER POLICY %I ON public.%I TO service_role',
      r.policyname, r.tablename
    );
    RAISE NOTICE 're-scoped policy % on %.% to service_role', r.policyname, 'public', r.tablename;
  END LOOP;
END $$;

-- Verification (run manually after applying — expect ZERO rows):
--   SELECT tablename, policyname, roles
--   FROM pg_policies
--   WHERE schemaname='public'
--     AND policyname LIKE 'service role full access %'
--     AND 'public' = ANY (roles);
