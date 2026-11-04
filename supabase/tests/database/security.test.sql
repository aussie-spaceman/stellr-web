-- pgTAP: function privileges and RLS on the CI database (multi-tenancy plan S1).
--
-- Runs in the `db` job of .github/workflows/ci.yml, against an ephemeral
-- database built from supabase/baseline.sql plus every timestamped migration:
--   npx supabase test db supabase/tests/database
-- Pass the directory: the other files in supabase/tests/ are manual
-- SQL-editor checks, not pgTAP, and pg_prove would fail on them.
--
-- The assertions are the pgTAP twin of supabase/tests/security_checks.sql (the
-- read-only query run by hand on dev and prod). Keep the RLS-helper allow-list
-- in step with that file and with FROZEN_RLS_HELPERS / the `rls-helper`
-- annotations in scripts/check-migration-security.mjs.
BEGIN;
SET LOCAL search_path = extensions, public;

SELECT plan(52);

-- The three relation checks are kept as text so the same query runs twice:
-- once against the real schema (must return nothing) and once against
-- deliberately bad probe objects at the end (must return exactly those), which
-- proves each check can fail. pg_temp is not in either schema checked.
CREATE TEMP TABLE relation_checks (name text PRIMARY KEY, query text NOT NULL);
INSERT INTO relation_checks VALUES
  -- Tables without row level security.
  ('rls', $q$
    SELECT n.nspname || '.' || c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'entitlements')
      AND c.relkind IN ('r', 'p')
      AND NOT c.relrowsecurity
  $q$),
  -- Views run with their owner's rights unless security_invoker is set, which
  -- bypasses the base tables' RLS. The schema's default privileges grant anon
  -- and authenticated ALL on every new relation in public, views included, so
  -- a plain `CREATE VIEW public.x AS SELECT * FROM participants` would hand
  -- every row to the Data API. The option value is cast with Postgres's own
  -- boolean parser, so on/true/yes/1 all count.
  ('views', $q$
    SELECT n.nspname || '.' || c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'entitlements')
      AND c.relkind = 'v'
      AND NOT COALESCE((
        SELECT bool_or(substr(o, length('security_invoker=') + 1)::boolean)
        FROM unnest(c.reloptions) AS o
        WHERE o LIKE 'security_invoker=%'
      ), false)
      AND (has_table_privilege('anon', c.oid, 'SELECT')
           OR has_table_privilege('authenticated', c.oid, 'SELECT'))
  $q$),
  -- Materialized views and foreign tables cannot have RLS at all, so the API
  -- roles must not be able to read them.
  ('unprotectable', $q$
    SELECT n.nspname || '.' || c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'entitlements')
      AND c.relkind IN ('m', 'f')
      AND (has_table_privilege('anon', c.oid, 'SELECT')
           OR has_table_privilege('authenticated', c.oid, 'SELECT'))
  $q$);

-- Guards against a vacuous pass: every check below is "no rows", which an
-- empty database also satisfies.
SELECT cmp_ok(
  (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public'), '>=', 100,
  'the baseline loaded: public has at least 100 tables'
);
SELECT cmp_ok(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef AND n.nspname IN ('public', 'entitlements')), '>=', 20,
  'the baseline loaded: at least 20 SECURITY DEFINER functions exist'
);

-- Deep review DB-N3 / S0-1: anon may execute NO definer function.
SELECT is_empty($q$
  SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prosecdef
    AND n.nspname IN ('public', 'entitlements')
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
$q$, 'anon can execute no SECURITY DEFINER function in public or entitlements');

-- authenticated may execute only the RLS helpers its SELECT policies call.
SELECT is_empty($q$
  SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prosecdef
    AND n.nspname IN ('public', 'entitlements')
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT (n.nspname = 'public' AND p.proname IN (
      'can_read_space',            -- community post/comment RLS
      'can_read_chat_channel',     -- chat_messages RLS
      'survey_current_member_id',  -- survey self-read RLS
      'space_unread_counts'        -- S0-9 open: revoke from authenticated next
    ))
$q$, 'authenticated can execute only the allow-listed RLS helper definer functions');

-- Everything the Data API could read is behind row level security: tables
-- have it on, views run as the caller, and the relations that cannot have RLS
-- are not readable by the API roles.
SELECT is_empty((SELECT query FROM relation_checks WHERE name = 'rls'),
  'every table in public and entitlements has RLS enabled');
SELECT is_empty((SELECT query FROM relation_checks WHERE name = 'views'),
  'every view anon or authenticated can read is security_invoker');
SELECT is_empty((SELECT query FROM relation_checks WHERE name = 'unprotectable'),
  'anon and authenticated cannot read any materialized view or foreign table');

-- The 14 functions sealed by 20261102220634_seal_definer_functions_db_n3:
-- anon never, authenticated only survey_current_member_id, service_role always.
-- 14 functions x 3 roles = 42 assertions. A missing function fails the cast.
WITH fns(sig, authenticated_ok) AS (
  VALUES
    ('public.esign_append_audit(uuid, uuid, text, text, text, jsonb)', false),
    ('public.esign_purge_audit(uuid)', false),
    ('public.esign_claim_email(date, int)', false),
    ('public.survey_submit_response(uuid, jsonb, boolean, text, boolean, boolean, text)', false),
    ('public.survey_redact_answer(uuid, text, text, text)', false),
    ('public.survey_purge_person(uuid, uuid[], text[], text)', false),
    ('public.survey_claim_email(date, int)', false),
    ('public.survey_responses_audit_delete()', false),
    ('public.survey_follow_participant_member()', false),
    ('public.tg_ensure_tier_space()', false),
    ('public.survey_current_member_id()', true),
    ('public.esign_verify_audit(uuid)', false),
    ('public.esign_audit_heads()', false),
    ('public.esign_audit_digest(text, uuid, uuid, text, timestamptz, text, text, jsonb)', false)
),
api_roles(role) AS (
  VALUES ('anon'), ('authenticated'), ('service_role')
)
SELECT is(
  has_function_privilege(api_roles.role, fns.sig::regprocedure, 'EXECUTE'),
  CASE api_roles.role
    WHEN 'anon' THEN false
    WHEN 'authenticated' THEN fns.authenticated_ok
    ELSE true
  END,
  format('DB-N3: %s EXECUTE on %s', api_roles.role, fns.sig)
)
FROM fns CROSS JOIN api_roles
ORDER BY fns.sig, api_roles.role;

-- Self-test: plant one bad object per relation check and confirm the check
-- reports exactly it. The invoker view is the control: the views check must
-- not flag a view that runs as the caller. All of this rolls back.
CREATE TABLE public.ci_probe_no_rls (x int);
-- Explicit, in case an event trigger switches RLS on for new tables.
ALTER TABLE public.ci_probe_no_rls DISABLE ROW LEVEL SECURITY;
CREATE VIEW public.ci_probe_definer_view AS SELECT 1 AS x;
CREATE VIEW public.ci_probe_invoker_view WITH (security_invoker = on) AS SELECT 1 AS x;
CREATE MATERIALIZED VIEW public.ci_probe_matview AS SELECT 1 AS x;
GRANT SELECT ON public.ci_probe_definer_view, public.ci_probe_invoker_view TO anon;
GRANT SELECT ON public.ci_probe_matview TO authenticated;

SELECT set_eq((SELECT query FROM relation_checks WHERE name = 'rls'),
  ARRAY['public.ci_probe_no_rls'],
  'self-test: the RLS check flags a table without RLS');
SELECT set_eq((SELECT query FROM relation_checks WHERE name = 'views'),
  ARRAY['public.ci_probe_definer_view'],
  'self-test: the views check flags an owner-rights view anon can read, and not an invoker view');
SELECT set_eq((SELECT query FROM relation_checks WHERE name = 'unprotectable'),
  ARRAY['public.ci_probe_matview'],
  'self-test: the materialized-view check flags one authenticated can read');

SELECT * FROM finish();
ROLLBACK;
