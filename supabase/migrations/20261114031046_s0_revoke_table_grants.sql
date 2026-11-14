-- =====================================================================
-- S0-3: revoke anon and authenticated table grants, keep an allow-list.
-- Closes the table-grant half of THREAT-MODEL R4 (TB5 S).
--
-- supabase/baseline.sql grants ALL on almost every public table, view and
-- sequence to anon and authenticated (about 102 tables), and the schema's
-- default privileges did the same for every table a later migration created
-- unless it revoked by hand. The publishable (anon) key ships in every page
-- bundle, so for those tables RLS was the only thing between the Data API and
-- the rows. This migration makes the grants match what the browser actually
-- uses, and leaves RLS as the row gate on what remains.
--
-- What it does:
--   1. REVOKE ALL on every table, view, materialized view, foreign table and
--      sequence in public and entitlements FROM PUBLIC, anon, authenticated,
--      table-level and column-level. entitlements is included as defence in
--      depth: PostgREST serves it, though USAGE on it was already revoked from
--      anon and authenticated (20261009162158).
--   2. GRANT back only the allow-list below.
--   3. Check the result, and fail (rolling the whole migration back) if anon
--      or authenticated still holds any privilege outside the allow-list, for
--      example on a relation the migrating role does not own and so cannot
--      revoke.
-- service_role and tenant_app are not touched: their grants are their own.
-- Functions are not touched here: the definer functions were sealed by
-- 20261102220634, and the default privileges for new objects are the next
-- migration (s0_default_privileges).
--
-- ── The allow-list, built from the code ────────────────────────────────────
-- The app reaches the database with the publishable key in exactly two
-- places, both in lib/supabase-browser.ts:
--   * createBrowserSupabase(): a Clerk-token client used ONLY for Realtime
--     postgres_changes subscriptions. Realtime checks that the subscriber's
--     role (authenticated) can SELECT the table and its filter column, then
--     applies the table's SELECT policy to each change.
--   * createStorageUploadClient(): PUTs to a signed Storage URL. Storage
--     schema only; no public table.
-- The server-side publishable-key client in lib/supabase.ts (`supabase`) has
-- no caller, and every raw /rest/v1 fetch (lib/crawlers.ts,
-- lib/tenancy/host.ts) uses the secret key. No browser code calls .from() or
-- .rpc().
--
--   role           relation                   privilege  why
--   authenticated  public.chat_messages       SELECT     Realtime INSERT feed in
--                                                        components/community/ChatPanel.tsx
--                                                        (filter channel_id); policy
--                                                        "members read own channel messages"
--   authenticated  public.community_posts     SELECT     Realtime feed in
--                                                        components/community/spaces/ChannelFeed.tsx
--                                                        (filter channel_id); policy
--                                                        "members read accessible space posts"
--   authenticated  public.community_channels  SELECT     read as the caller by the inline
--                                                        subquery in the community_posts
--                                                        SELECT policy; it has no
--                                                        authenticated policy, so RLS shows
--                                                        no rows
--   anon           (nothing)
--
-- The RLS helpers those policies call (can_read_chat_channel, can_read_space)
-- are SECURITY DEFINER, so they read the member, chat and space tables as
-- their owner and need no table grant to authenticated.
--
-- Considered and left out, because no code path uses them (grant explicitly,
-- in the migration that adds the caller, if one ever does):
--   * public.community_comments: in the supabase_realtime publication with an
--     authenticated SELECT policy (071), but nothing subscribes to it.
--   * public.survey_responses, public.survey_answers: authenticated self-read
--     policies (20261002235036), but surveys are read server-side with the
--     secret key only. survey_current_member_id keeps its EXECUTE grant.
--   * public.members: legacy policies (members_self_read and others) with no
--     anon or authenticated caller.
--
-- Idempotent: REVOKE and GRANT give the same result when run again.
-- =====================================================================

-- 1. Revoke everything from the public web roles.
DO $$
DECLARE
  r record;
  col record;
BEGIN
  FOR r IN
    SELECT c.oid, c.relkind, format('%I.%I', n.nspname, c.relname) AS rel
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'entitlements')
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    ORDER BY 3
  LOOP
    IF r.relkind = 'S' THEN
      EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', r.rel);
    ELSE
      EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated', r.rel);
      -- A table-level REVOKE ALL leaves column grants in place, so take any
      -- that name these roles too.
      FOR col IN
        SELECT DISTINCT a.attname
        FROM pg_attribute a
        CROSS JOIN LATERAL aclexplode(a.attacl) x
        WHERE a.attrelid = r.oid
          AND a.attnum > 0
          AND NOT a.attisdropped
          AND a.attacl IS NOT NULL
          AND (x.grantee = 0
               OR x.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))
      LOOP
        EXECUTE format('REVOKE ALL (%I) ON TABLE %s FROM PUBLIC, anon, authenticated', col.attname, r.rel);
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- 2. The allow-list (see the header). RLS stays the row gate.
GRANT SELECT ON public.chat_messages      TO authenticated;
GRANT SELECT ON public.community_posts    TO authenticated;
GRANT SELECT ON public.community_channels TO authenticated;

-- 3. Fail closed: refuse to commit if anything outside the allow-list remains,
--    whether through a grant this role could not revoke, a column grant,
--    PUBLIC or a role membership.
DO $$
DECLARE
  leftover text;
BEGIN
  WITH rels AS (
    SELECT c.oid, c.relkind, format('%I.%I', n.nspname, c.relname) AS rel
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'entitlements')
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
  ),
  held AS (
    SELECT g.role, p.priv, r.rel
    FROM rels r
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS g(role)
    CROSS JOIN LATERAL unnest(
      CASE WHEN r.relkind = 'S' THEN ARRAY['USAGE', 'SELECT', 'UPDATE']
           ELSE ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] END
    ) AS p(priv)
    WHERE CASE WHEN r.relkind = 'S' THEN has_sequence_privilege(g.role, r.oid, p.priv)
               ELSE has_table_privilege(g.role, r.oid, p.priv) END
    UNION ALL
    SELECT g.role, 'COLUMN ' || p.priv, r.rel
    FROM rels r
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS g(role)
    CROSS JOIN LATERAL unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) AS p(priv)
    WHERE r.relkind <> 'S'
      AND has_any_column_privilege(g.role, r.oid, p.priv)
      AND NOT has_table_privilege(g.role, r.oid, p.priv)
  )
  SELECT string_agg(format('%s %s on %s', role, priv, rel), '; ' ORDER BY rel, role, priv)
  INTO leftover
  FROM held
  WHERE (role, priv, rel) NOT IN (
    VALUES ('authenticated', 'SELECT', 'public.chat_messages'),
           ('authenticated', 'SELECT', 'public.community_posts'),
           ('authenticated', 'SELECT', 'public.community_channels')
  );

  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'S0-3: privileges outside the allow-list remain: %', leftover
      USING HINT = 'A relation the migrating role does not own keeps grants it cannot revoke. Revoke them as the owner, then run this again.';
  END IF;
END $$;

-- PostgREST re-reads its schema cache (delivered at commit).
NOTIFY pgrst, 'reload schema';
