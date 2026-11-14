-- pgTAP: the Google Sheets push-channel token (threat model §6.11, S0; migration
-- sheet_watch_channel_token).
--
-- Runs in the `db` job of .github/workflows/ci.yml with the other files in this
-- directory. Covers: the column's shape, that the table stays service-role only
-- (RLS on, the one service_role policy, and no table or column privilege for anon
-- or authenticated), and what each role gets when it actually reads the table.
BEGIN;
SET LOCAL search_path = extensions, public;

SELECT plan(12);

-- ── 1. The column ───────────────────────────────────────────────────────────
SELECT has_column('public', 'sheet_watch_channels', 'token', 'sheet_watch_channels has a token column');
SELECT col_type_is('public', 'sheet_watch_channels', 'token', 'text', 'token is text');
SELECT col_is_null('public', 'sheet_watch_channels', 'token',
  'token is nullable, so channels registered before the change still load');

-- ── 2. Service-role only ────────────────────────────────────────────────────
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sheet_watch_channels'::regclass),
  'sheet_watch_channels has RLS enabled');
SELECT set_eq(
  $q$SELECT policyname::text || ':' || array_to_string(roles, ',') FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'sheet_watch_channels'$q$,
  ARRAY['service role full access:service_role'],
  'its only policy is the service_role one');
SELECT ok(NOT has_table_privilege('anon', 'public.sheet_watch_channels', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'anon holds no privilege on the table');
SELECT ok(NOT has_table_privilege('authenticated', 'public.sheet_watch_channels', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'authenticated holds no privilege on the table');
SELECT ok(NOT has_column_privilege('anon', 'public.sheet_watch_channels', 'token', 'SELECT, INSERT, UPDATE, REFERENCES')
          AND NOT has_column_privilege('authenticated', 'public.sheet_watch_channels', 'token', 'SELECT, INSERT, UPDATE, REFERENCES'),
  'neither anon nor authenticated can read or write the token column');
SELECT ok(has_table_privilege('service_role', 'public.sheet_watch_channels', 'SELECT, INSERT'),
  'service_role can read and insert');

-- ── 3. As each role ─────────────────────────────────────────────────────────
-- The read runs inside a DO block under the role and records what happened in a
-- transaction-local setting, so the pgTAP calls themselves stay on the test's own
-- role (pgTAP's bookkeeping table is not the API roles' to write).
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['service_role', 'anon', 'authenticated'] LOOP
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', r);
      PERFORM token FROM public.sheet_watch_channels LIMIT 1;
      RESET ROLE;
      PERFORM set_config('swc_test.' || r, 'read', true);
    EXCEPTION WHEN insufficient_privilege THEN
      RESET ROLE;
      PERFORM set_config('swc_test.' || r, '42501', true);
    END;
  END LOOP;
END $$;
SELECT is(current_setting('swc_test.service_role'), 'read', 'service_role can read the token column');
SELECT is(current_setting('swc_test.anon'), '42501', 'anon reading the table is refused outright, not just filtered by RLS');
SELECT is(current_setting('swc_test.authenticated'), '42501', 'authenticated reading the table is refused outright');

SELECT * FROM finish();
ROLLBACK;
