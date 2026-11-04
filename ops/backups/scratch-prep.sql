-- scratch-prep.sql — make a stock Postgres 17 look enough like Supabase for a
-- restore drill. Run by restore-drill.sh against the scratch database only.
--
-- The dump's tables need: the Supabase API roles (grants and policies name
-- them), the `extensions` schema with uuid-ossp and pgcrypto (column defaults
-- and the e-sign audit digest call them), and an empty `storage` schema for
-- the storage metadata tables. Objects that need Supabase-only extensions
-- (pg_graphql, pg_net, vault) or the `auth` schema fail to restore; the drill
-- counts those errors and judges the restore by the data, table by table.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'authenticator',
                           'supabase_admin', 'supabase_storage_admin', 'dashboard_user']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END $$;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA extensions;

-- RLS policies call auth.uid() / auth.jwt(); stubs let them be created.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;

DO $p$ BEGIN
  EXECUTE format('ALTER DATABASE %I SET search_path = "$user", public, extensions', current_database());
END $p$;
