-- =====================================================================
-- S0-1b: seal the default privileges, so new tables, sequences and functions
-- start with no grant to anon or authenticated.
-- Closes THREAT-MODEL R4a (TB5 E) with the grant revoke before it
-- (s0_revoke_table_grants).
--
-- supabase/baseline.sql records these defaults, for objects created by
-- postgres (and the same for supabase_admin):
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, ...
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, ...
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, ...
-- so every new table was readable and writable with the publishable key the
-- moment it landed, guarded only by RLS, and every new function was callable
-- (the DB-N3 hole, SECURITY-HOTFIX-C-2026-11-02.md).
--
-- What changes, for objects postgres creates from now on:
--   * public tables, views and sequences: no grant to anon or authenticated.
--   * public functions: no EXECUTE for anon or authenticated.
--   * functions in any schema: no EXECUTE for PUBLIC. Postgres grants EXECUTE
--     to PUBLIC through a built-in global default, and a per-schema
--     ALTER DEFAULT PRIVILEGES can only add to a global default, never take
--     away from it (so `IN SCHEMA public REVOKE ... FROM PUBLIC`, like the one
--     in 20261009162158 for entitlements, changes nothing). Only the global
--     form below removes it; without it anon and authenticated would still
--     execute every new function through PUBLIC.
--   * The extensions schema gets PUBLIC EXECUTE back as a per-schema default,
--     so an extension postgres installs there later (pgTAP in CI, say) works
--     as it does today. PostgREST does not serve that schema.
-- service_role keeps its defaults (ALL on tables, sequences and functions in
-- public), and existing objects keep their grants: s0_revoke_table_grants
-- handles the tables.
--
-- supabase_admin: on the hosted projects postgres may not change another
-- role's default privileges ("permission denied to change default
-- privileges"; see the note above them in supabase/baseline.sql). The block
-- at the end tries, and reports a NOTICE when it is not permitted. Objects
-- supabase_admin creates in public keep the old defaults; app migrations run
-- as postgres.
--
-- ── Rule for every later migration ──────────────────────────────────────────
-- Nothing is granted by default any more. A migration that adds a table,
-- view, sequence or function must GRANT explicitly to each role that needs
-- it (service_role gets its defaults; tenant_app, authenticated and anon do
-- not), and must still REVOKE from PUBLIC, anon and authenticated where the
-- security lint asks for it, since a database built before this migration, or
-- objects created by another role, keep the old defaults.
--
-- Idempotent: ALTER DEFAULT PRIVILEGES gives the same result when run again.
-- =====================================================================

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- The global default (no IN SCHEMA): the only form that removes PUBLIC.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Keep today's behaviour for extensions postgres installs into `extensions`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA extensions
      GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
  END IF;
END $$;

-- supabase_admin, where this role is permitted to change its defaults.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
      REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
      REVOKE ALL ON SEQUENCES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
      REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'S0-1b: % may not change supabase_admin''s default privileges; objects supabase_admin creates in public keep the old defaults.', current_user;
END $$;
