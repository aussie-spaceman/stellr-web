-- pgTAP: table grants and default privileges for the public web roles
-- (S0-3 and S0-1b; migrations s0_revoke_table_grants and s0_default_privileges).
--
-- Runs in the `db` job of .github/workflows/ci.yml with the other files in this
-- directory, against a database built from supabase/baseline.sql plus every
-- timestamped migration.
--
-- Covers:
--   1. anon holds no privilege on any table, view or sequence in public or
--      entitlements; authenticated holds exactly the allow-list.
--   2. service_role keeps its access.
--   3. What the catalog says is what Postgres enforces (reads as each role).
--   4. A table, sequence and function created after the migrations start with
--      no grant to anon or authenticated, and with service_role's.
--
-- The allow-list is the one in the header of s0_revoke_table_grants. Change
-- both together, and only for a code path that needs it.
BEGIN;
SET LOCAL search_path = extensions, public;

SELECT plan(26);

-- Every privilege anon and authenticated hold on a relation in public or
-- entitlements, however they hold it (direct grant, PUBLIC, membership).
-- Column grants are listed as 'COLUMN <privilege>' when there is no matching
-- table-level grant.
CREATE TEMP VIEW s0_api_privileges AS
WITH rels AS (
  SELECT c.oid, c.relkind, format('%I.%I', n.nspname, c.relname) AS rel
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'entitlements')
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
)
SELECT g.role, p.priv, r.rel
FROM rels r
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS g(role)
CROSS JOIN LATERAL unnest(
  CASE WHEN r.relkind = 'S' THEN ARRAY['USAGE', 'SELECT', 'UPDATE']
       ELSE ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
            || CASE WHEN current_setting('server_version_num')::int >= 170000
                    THEN ARRAY['MAINTAIN'] ELSE ARRAY[]::text[] END
  END
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
  AND NOT has_table_privilege(g.role, r.oid, p.priv);

-- Guards against a vacuous pass: an empty database holds no grants either.
SELECT cmp_ok(
  (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public'), '>=', 100,
  'the baseline loaded: public has at least 100 tables'
);

-- ── 1. The allow-list ───────────────────────────────────────────────────────
SELECT is_empty(
  $q$SELECT priv || ' on ' || rel FROM s0_api_privileges WHERE role = 'anon'$q$,
  'anon holds no privilege on any table, view or sequence in public or entitlements'
);

SELECT set_eq(
  $q$SELECT priv || ' on ' || rel FROM s0_api_privileges WHERE role = 'authenticated'$q$,
  ARRAY[
    'SELECT on public.chat_messages',
    'SELECT on public.community_posts',
    'SELECT on public.community_channels'
  ],
  'authenticated holds exactly the allow-list: SELECT on chat_messages, community_posts, community_channels'
);

-- The two Realtime feeds the allow-list exists for are still published.
SELECT ok(
  EXISTS (SELECT 1 FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_messages'),
  'chat_messages is in the supabase_realtime publication'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'community_posts'),
  'community_posts is in the supabase_realtime publication'
);

-- ── 2. service_role keeps its access ────────────────────────────────────────
SELECT is_empty($q$
  SELECT format('%I.%I', n.nspname, c.relname)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v')
    AND NOT has_table_privilege('service_role', c.oid, 'SELECT')
$q$, 'service_role can still SELECT every table and view in public');

SELECT ok(has_table_privilege('service_role', 'public.members', 'SELECT')
          AND has_table_privilege('service_role', 'public.members', 'INSERT')
          AND has_table_privilege('service_role', 'public.members', 'UPDATE')
          AND has_table_privilege('service_role', 'public.members', 'DELETE'),
  'service_role keeps SELECT, INSERT, UPDATE, DELETE on members');
SELECT ok(has_table_privilege('service_role', 'public.participants', 'SELECT')
          AND has_table_privilege('service_role', 'public.participants', 'INSERT')
          AND has_table_privilege('service_role', 'public.participants', 'UPDATE')
          AND has_table_privilege('service_role', 'public.participants', 'DELETE'),
  'service_role keeps SELECT, INSERT, UPDATE, DELETE on participants');
SELECT ok(has_table_privilege('service_role', 'public.registrations', 'SELECT')
          AND has_table_privilege('service_role', 'public.registrations', 'INSERT')
          AND has_table_privilege('service_role', 'public.registrations', 'UPDATE')
          AND has_table_privilege('service_role', 'public.registrations', 'DELETE'),
  'service_role keeps SELECT, INSERT, UPDATE, DELETE on registrations');
SELECT ok(has_table_privilege('service_role', 'public.chat_messages', 'SELECT')
          AND has_table_privilege('service_role', 'public.chat_messages', 'INSERT')
          AND has_table_privilege('service_role', 'public.chat_messages', 'UPDATE')
          AND has_table_privilege('service_role', 'public.chat_messages', 'DELETE'),
  'service_role keeps SELECT, INSERT, UPDATE, DELETE on chat_messages');
SELECT ok(has_sequence_privilege('service_role', 'public.participants_membership_id_seq', 'USAGE'),
  'service_role keeps USAGE on participants_membership_id_seq');

-- ── 3. Enforcement, read as each role ───────────────────────────────────────
-- Each probe records its outcome in a transaction-local setting, so no pgTAP
-- function has to run as the probed role.
SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM 1 FROM public.cron_runs LIMIT 1;
  PERFORM set_config('s0.anon_cron_runs', 'read', true);
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM set_config('s0.anon_cron_runs', '42501', true);
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM 1 FROM public.members LIMIT 1;
  PERFORM set_config('s0.authenticated_members', 'read', true);
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM set_config('s0.authenticated_members', '42501', true);
END $$;
DO $$ BEGIN
  PERFORM 1 FROM public.chat_messages LIMIT 1;
  PERFORM set_config('s0.authenticated_chat_messages', 'read', true);
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM set_config('s0.authenticated_chat_messages', '42501', true);
END $$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$ BEGIN
  PERFORM 1 FROM public.cron_runs LIMIT 1;
  PERFORM set_config('s0.service_role_cron_runs', 'read', true);
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM set_config('s0.service_role_cron_runs', '42501', true);
END $$;
RESET ROLE;

SELECT is(current_setting('s0.anon_cron_runs', true), '42501',
  'anon reading cron_runs is refused with 42501');
SELECT is(current_setting('s0.authenticated_members', true), '42501',
  'authenticated reading members is refused with 42501');
SELECT is(current_setting('s0.authenticated_chat_messages', true), 'read',
  'authenticated can still read chat_messages (RLS filters the rows)');
SELECT is(current_setting('s0.service_role_cron_runs', true), 'read',
  'service_role can still read cron_runs');

-- ── 4. Objects created after the migrations ─────────────────────────────────
-- Default privileges belong to the creating role, and app migrations run as
-- postgres, so the probes are created as postgres. All of this rolls back.
SELECT is_empty($q$
  SELECT d.defaclobjtype || ' in ' || COALESCE(n.nspname, '(every schema)') || ' to '
         || pg_get_userbyid(x.grantee)
  FROM pg_default_acl d
  LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) x
  WHERE d.defaclrole = 'postgres'::regrole
    AND (d.defaclnamespace = 0 OR n.nspname = 'public')
    AND x.grantee IN ('anon'::regrole, 'authenticated'::regrole)
$q$, 'postgres''s default privileges in public (and globally) grant nothing to anon or authenticated');

SET LOCAL ROLE postgres;
CREATE TABLE public.s0_probe_new_table (id int PRIMARY KEY);
ALTER TABLE public.s0_probe_new_table ENABLE ROW LEVEL SECURITY;
CREATE SEQUENCE public.s0_probe_new_seq;
CREATE FUNCTION public.s0_probe_new_fn() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;
RESET ROLE;

SELECT is_empty(
  $q$SELECT priv FROM s0_api_privileges WHERE role = 'anon' AND rel = 'public.s0_probe_new_table'$q$,
  'a new table: anon holds no privilege'
);
SELECT is_empty(
  $q$SELECT priv FROM s0_api_privileges WHERE role = 'authenticated' AND rel = 'public.s0_probe_new_table'$q$,
  'a new table: authenticated holds no privilege'
);
SELECT ok(has_table_privilege('service_role', 'public.s0_probe_new_table', 'SELECT')
          AND has_table_privilege('service_role', 'public.s0_probe_new_table', 'INSERT')
          AND has_table_privilege('service_role', 'public.s0_probe_new_table', 'UPDATE')
          AND has_table_privilege('service_role', 'public.s0_probe_new_table', 'DELETE'),
  'a new table: service_role has SELECT, INSERT, UPDATE, DELETE');
SELECT is_empty(
  $q$SELECT role || ' ' || priv FROM s0_api_privileges WHERE rel = 'public.s0_probe_new_seq'$q$,
  'a new sequence: anon and authenticated hold no privilege'
);
SELECT ok(has_sequence_privilege('service_role', 'public.s0_probe_new_seq', 'USAGE'),
  'a new sequence: service_role has USAGE');
SELECT ok(NOT has_function_privilege('anon', 'public.s0_probe_new_fn()', 'EXECUTE'),
  'a new function: anon cannot execute it (not directly, not through PUBLIC)');
SELECT ok(NOT has_function_privilege('authenticated', 'public.s0_probe_new_fn()', 'EXECUTE'),
  'a new function: authenticated cannot execute it');
SELECT ok(has_function_privilege('service_role', 'public.s0_probe_new_fn()', 'EXECUTE'),
  'a new function: service_role can execute it');

SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM 1 FROM public.s0_probe_new_table LIMIT 1;
  PERFORM set_config('s0.anon_new_table', 'read', true);
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM set_config('s0.anon_new_table', '42501', true);
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM public.s0_probe_new_fn();
  PERFORM set_config('s0.authenticated_new_fn', 'executed', true);
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM set_config('s0.authenticated_new_fn', '42501', true);
END $$;
RESET ROLE;

SELECT is(current_setting('s0.anon_new_table', true), '42501',
  'a new table: anon reading it is refused with 42501');
SELECT is(current_setting('s0.authenticated_new_fn', true), '42501',
  'a new function: authenticated calling it is refused with 42501');

SELECT * FROM finish();
ROLLBACK;
