-- S4 FORCE RLS readiness (multi-tenancy plan). READ-ONLY: run by hand in the
-- Supabase SQL editor (dev first, then production), outside event hours.
-- Not pgTAP and not run by CI. docs/TENANCY-S4.md, "FORCE RLS: the later
-- step", says what each answer must be before the FORCE migration is written.
--
-- Why it matters: FORCE ROW LEVEL SECURITY makes RLS apply to a table's
-- OWNER. Every SECURITY DEFINER function below runs as its owner (postgres).
-- If that owner lacks BYPASSRLS, FORCE silently hides rows from it: the
-- derivation trigger would stop finding events and stamp every new row with
-- Stellr's tenant (rehearsed on Postgres 17: docs/S4-SPIKE.md, §6).

-- A. Who bypasses RLS. FORCE is safe for the definer functions only if their
--    owner (normally postgres) shows rolbypassrls = true. service_role must
--    show true (all live app traffic). tenant_app must show false.
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
FROM pg_roles
WHERE rolname IN ('postgres', 'supabase_admin', 'service_role', 'authenticated', 'anon', 'tenant_app')
ORDER BY rolname;

-- B. Owner and FORCE state of every table carrying tenant_id. Expect owner
--    postgres and force = false until the FORCE migration lands.
SELECT c.oid::regclass AS table_name, pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity AS rls, c.relforcerowsecurity AS force
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY 1;

-- C. SECURITY DEFINER functions that read or write a tenant table, with
--    whether their owner bypasses RLS. Every row must show
--    owner_bypasses_rls = true before FORCE, or the function needs its own
--    policy (or a rewrite) first.
WITH tenant_tables AS (
  SELECT c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
  WHERE n.nspname = 'public' AND c.relkind = 'r'
)
SELECT p.oid::regprocedure AS function_name, pg_get_userbyid(p.proowner) AS owner,
       r.rolbypassrls AS owner_bypasses_rls,
       array_agg(t.relname ORDER BY t.relname) AS tenant_tables_named
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_roles r ON r.oid = p.proowner
JOIN tenant_tables t ON p.prosrc ~* ('\m' || t.relname || '\M')
WHERE p.prosecdef AND n.nspname IN ('public', 'entitlements')
GROUP BY 1, 2, 3
ORDER BY 1;

-- D. Policies that apply to roles other than service_role and tenant_app on
--    tenant tables (authenticated survey/community reads, Realtime). FORCE
--    does not change these, but list them so the FORCE review sees them.
SELECT schemaname || '.' || tablename AS table_name, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (SELECT c.relname FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id'
                    JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r')
  AND NOT (roles <@ ARRAY['service_role', 'tenant_app']::name[])
ORDER BY 1, 2;

-- E. Storage: who owns storage.objects, and could the current role (run this
--    as the role migrations run as) add policies to it? S5's tenant storage
--    policies need can_add_policies = true, or the owner adds them in the
--    dashboard instead.
SELECT pg_get_userbyid(c.relowner) AS objects_owner,
       pg_has_role(current_user, c.relowner, 'USAGE') AS can_add_policies,
       c.relrowsecurity AS rls
FROM pg_class c
WHERE c.oid = 'storage.objects'::regclass;

-- F. The S4 objects are in place (after 20261104200000 and 20261104210000).
SELECT
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenant_app' AND NOT rolbypassrls AND NOT rolcanlogin) AS tenant_role_ok,
  to_regprocedure('public.app_tenant_id()') IS NOT NULL AS helper_ok,
  to_regprocedure('public.storage_object_tenant_id(text)') IS NOT NULL AS storage_helper_ok,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname IN ('tenant_isolation', 'tenant_isolation_guard')) AS tenant_policies; -- expect 70
