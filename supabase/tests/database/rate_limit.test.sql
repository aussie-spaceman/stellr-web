-- pgTAP: the Postgres rate limiter (S5 B4, migration rate_limit).
--
-- Runs in the `db` job of .github/workflows/ci.yml with the other files in this
-- directory. Covers: shape and privileges, the limit and its reset, a take across
-- several windows, input checks, gc, and the JSON form PostgREST sends.
--
-- The concurrency checks open real separate sessions through dblink, because one
-- transaction cannot race itself. Those sessions commit, so their rows outlive
-- the ROLLBACK. Their keys are random and the CI database is thrown away. They
-- log in the way CI's own psql steps do, with the local database's default
-- password (see ci.yml), so this file only runs against that throwaway database.
--
-- Elsewhere the clock is frozen inside this transaction, since now() is its start
-- time, so "the window has passed" is arranged by moving window_start back.
BEGIN;
SET LOCAL search_path = extensions, public;

SELECT plan(38);

-- Fixture keys: 32 bytes each, as the table's CHECK requires.
CREATE TEMP TABLE rl_keys ON COMMIT DROP AS
SELECT sha256('one'::bytea) AS one, sha256('two'::bytea) AS two, sha256('three'::bytea) AS three,
       sha256('four'::bytea) AS four, sha256('five'::bytea) AS five, sha256('six'::bytea) AS six,
       sha256('seven'::bytea) AS seven;

-- ── 1. Shape and privileges ─────────────────────────────────────────────────
SELECT has_table('public', 'rate_limit_hits', 'rate_limit_hits exists');
SELECT is((SELECT relpersistence::text FROM pg_class WHERE oid = 'public.rate_limit_hits'::regclass), 'u', 'it is UNLOGGED');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.rate_limit_hits'::regclass), 'it has RLS enabled');
SELECT ok(NOT has_table_privilege('anon', 'public.rate_limit_hits', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
          AND NOT has_table_privilege('authenticated', 'public.rate_limit_hits', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
          AND NOT has_table_privilege('tenant_app', 'public.rate_limit_hits', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'),
  'anon, authenticated and tenant_app hold nothing on the table');
SELECT ok(has_table_privilege('service_role', 'public.rate_limit_hits', 'SELECT'), 'service_role can read');
SELECT ok(NOT has_table_privilege('service_role', 'public.rate_limit_hits', 'INSERT, UPDATE, DELETE, TRUNCATE'), 'service_role cannot write directly');

SELECT ok(NOT has_function_privilege('anon', 'public.rate_limit_take(bytea[], int[], int[])', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.rate_limit_take(bytea[], int[], int[])', 'EXECUTE')
          AND NOT has_function_privilege('tenant_app', 'public.rate_limit_take(bytea[], int[], int[])', 'EXECUTE'),
  'anon, authenticated and tenant_app cannot execute rate_limit_take');
SELECT ok(NOT has_function_privilege('anon', 'public.rate_limit_gc()', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.rate_limit_gc()', 'EXECUTE')
          AND NOT has_function_privilege('tenant_app', 'public.rate_limit_gc()', 'EXECUTE'),
  'anon, authenticated and tenant_app cannot execute rate_limit_gc');
SELECT ok(has_function_privilege('service_role', 'public.rate_limit_take(bytea[], int[], int[])', 'EXECUTE'), 'service_role can execute rate_limit_take');
SELECT ok(has_function_privilege('service_role', 'public.rate_limit_gc()', 'EXECUTE'), 'service_role can execute rate_limit_gc');
SELECT ok(
  (SELECT bool_and(prosecdef AND proconfig @> ARRAY['search_path=""']) FROM pg_proc
    WHERE oid IN ('public.rate_limit_take(bytea[], int[], int[])'::regprocedure, 'public.rate_limit_gc()'::regprocedure)),
  'both functions are SECURITY DEFINER with a pinned search_path');
SELECT ok(
  (SELECT proconfig @> ARRAY['lock_timeout=300ms'] FROM pg_proc
    WHERE oid = 'public.rate_limit_take(bytea[], int[], int[])'::regprocedure),
  'a take gives up waiting for a row lock at the app''s 300 ms budget');

-- ── 2. The limit and its reset ──────────────────────────────────────────────
CREATE TEMP TABLE rl_sequence (i int, allowed boolean) ON COMMIT DROP;
DO $$ BEGIN
  FOR i IN 1..5 LOOP
    INSERT INTO rl_sequence
    SELECT i, r.allowed FROM rl_keys, public.rate_limit_take(ARRAY[one], ARRAY[3], ARRAY[60]) AS r;
  END LOOP;
END $$;
SELECT results_eq(
  $q$SELECT allowed FROM rl_sequence ORDER BY i$q$,
  ARRAY[true, true, true, false, false],
  'takes within the limit are allowed, and those past it are denied');
SELECT is((SELECT hits FROM public.rate_limit_hits, rl_keys WHERE key_hash = one AND window_seconds = 60), 5, 'denied takes still count');
SELECT ok(
  (SELECT r.retry_after BETWEEN 1 AND 60 FROM rl_keys, public.rate_limit_take(ARRAY[one], ARRAY[3], ARRAY[60]) AS r),
  'a denial says how long to wait');
SELECT is(
  (SELECT r.retry_after FROM rl_keys, public.rate_limit_take(ARRAY[two], ARRAY[3], ARRAY[60]) AS r), 0,
  'an allowed take has no wait');

UPDATE public.rate_limit_hits SET window_start = now() - interval '61 seconds'
  FROM rl_keys WHERE key_hash = one AND window_seconds = 60;
SELECT ok(
  (SELECT r.allowed FROM rl_keys, public.rate_limit_take(ARRAY[one], ARRAY[3], ARRAY[60]) AS r),
  'the first take after the window has passed is allowed');
SELECT is((SELECT hits FROM public.rate_limit_hits, rl_keys WHERE key_hash = one AND window_seconds = 60), 1, 'and it restarts the count');
SELECT is((SELECT window_start FROM public.rate_limit_hits, rl_keys WHERE key_hash = one AND window_seconds = 60), now(), 'and the window');

-- ── 3. Several windows in one take ──────────────────────────────────────────
-- key three, window 60: exhausted, and resets in about 60 seconds.
-- key three, window 3600: exhausted, with about 3600 seconds to go.
DO $$ BEGIN
  PERFORM public.rate_limit_take(ARRAY[three, three], ARRAY[1, 1], ARRAY[60, 3600]) FROM rl_keys;
END $$;
SELECT is(
  (SELECT r.retry_after > 60 FROM rl_keys, public.rate_limit_take(ARRAY[three, three], ARRAY[1, 1], ARRAY[3600, 60]) AS r),
  true, 'the first denial in the caller''s order is the one returned, listing the long window first');
SELECT is(
  (SELECT r.retry_after <= 60 FROM rl_keys, public.rate_limit_take(ARRAY[three, three], ARRAY[1, 1], ARRAY[60, 3600]) AS r),
  true, 'and listing the short window first');
SELECT is(
  (SELECT count(*)::int FROM public.rate_limit_take((SELECT ARRAY[four, five] FROM rl_keys), ARRAY[1, 1], ARRAY[60, 60])),
  1, 'a take returns one row, however many windows it has');
SELECT ok(
  NOT (SELECT r.allowed FROM rl_keys, public.rate_limit_take(ARRAY[four, six], ARRAY[1, 1], ARRAY[60, 60]) AS r),
  'one window denying denies the take');
SELECT is((SELECT hits FROM public.rate_limit_hits, rl_keys WHERE key_hash = six), 1, 'the other windows in a denied take still count');

-- ── 4. Input checks ─────────────────────────────────────────────────────────
SELECT throws_ok($q$SELECT public.rate_limit_take(ARRAY[]::bytea[], ARRAY[]::int[], ARRAY[]::int[])$q$, '22023', NULL, 'no keys are refused');
SELECT throws_ok($q$SELECT public.rate_limit_take(NULL, NULL, NULL)$q$, '22023', NULL, 'NULL arrays are refused');
SELECT throws_ok($q$SELECT public.rate_limit_take((SELECT ARRAY[one] FROM rl_keys), ARRAY[1, 2], ARRAY[60])$q$, '22023', NULL, 'mismatched lengths are refused');
SELECT throws_ok($q$SELECT public.rate_limit_take((SELECT ARRAY[one] FROM rl_keys), ARRAY[0], ARRAY[60])$q$, '22023', NULL, 'a limit below 1 is refused');
SELECT throws_ok($q$SELECT public.rate_limit_take((SELECT ARRAY[one] FROM rl_keys), ARRAY[1], ARRAY[0])$q$, '22023', NULL, 'a zero window is refused');
SELECT throws_ok($q$SELECT public.rate_limit_take(ARRAY['\x00'::bytea], ARRAY[1], ARRAY[60])$q$, '23514', NULL, 'a key that is not 32 bytes is refused');

-- ── 5. gc ───────────────────────────────────────────────────────────────────
DELETE FROM public.rate_limit_hits;
DO $$ BEGIN
  PERFORM public.rate_limit_take(ARRAY[one, two], ARRAY[1, 1], ARRAY[60, 60]) FROM rl_keys;
END $$;
UPDATE public.rate_limit_hits SET window_start = now() - interval '61 seconds' FROM rl_keys WHERE key_hash = one;
SELECT is(public.rate_limit_gc(), 1, 'gc deletes the expired window and reports the count');
SELECT is(
  (SELECT array_agg(encode(key_hash, 'hex')) FROM public.rate_limit_hits),
  (SELECT ARRAY[encode(two, 'hex')] FROM rl_keys),
  'and keeps the live one');

-- Takes clear expired windows themselves, one take in 100. With this many takes
-- the chance of no clear-up at all is about 1 in 10^13, and setseed fixes the run.
DO $$ BEGIN
  PERFORM public.rate_limit_take(ARRAY[three], ARRAY[1], ARRAY[60]) FROM rl_keys;
END $$;
UPDATE public.rate_limit_hits SET window_start = now() - interval '61 seconds' FROM rl_keys WHERE key_hash = three;
DO $$ BEGIN
  PERFORM setseed(0.25);
  FOR i IN 1..3000 LOOP
    PERFORM public.rate_limit_take(ARRAY[two], ARRAY[1000000], ARRAY[60]) FROM rl_keys;
  END LOOP;
END $$;
SELECT is((SELECT count(*)::int FROM public.rate_limit_hits, rl_keys WHERE key_hash = three), 0, 'takes clear expired windows as they go');
SELECT is((SELECT hits FROM public.rate_limit_hits, rl_keys WHERE key_hash = two), 3001, 'and leave live ones alone');

-- ── 6. What PostgREST sends ─────────────────────────────────────────────────
-- It reads an RPC's arguments from JSON the same way json_to_recordset does, so
-- this pins the '\x…' strings lib/rate-limit-store.ts sends as a real bytea[].
SELECT is(
  (SELECT x.p_keys FROM rl_keys CROSS JOIN LATERAL json_to_recordset(json_build_array(json_build_object(
     'p_keys', json_build_array('\x' || encode(seven, 'hex'))))) AS x(p_keys bytea[])),
  (SELECT ARRAY[seven] FROM rl_keys),
  'a JSON array of \x hex strings decodes to the bytes');

-- ── 7. Real concurrency ─────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

CREATE TEMP TABLE rl_race (allowed boolean) ON COMMIT DROP;
CREATE TEMP TABLE rl_race_key ON COMMIT DROP AS
SELECT sha256(convert_to(gen_random_uuid()::text, 'UTF8')) AS one, sha256(convert_to(gen_random_uuid()::text, 'UTF8')) AS two;

DO $$
DECLARE
  v_conn text := format('host=127.0.0.1 port=5432 dbname=%s user=postgres password=postgres', current_database());
  v_one text;
  v_two text;
  i int;
BEGIN
  SELECT encode(one, 'hex'), encode(two, 'hex') INTO v_one, v_two FROM rl_race_key;

  FOR i IN 1..16 LOOP
    PERFORM dblink_connect('rl_' || i, v_conn);
  END LOOP;

  -- Sessions 1 to 8 race on one key, with a limit of 5.
  FOR i IN 1..8 LOOP
    PERFORM dblink_send_query('rl_' || i, format(
      $q$SELECT allowed FROM public.rate_limit_take(ARRAY[decode(%L, 'hex')], ARRAY[5], ARRAY[60])$q$, v_one));
  END LOOP;
  -- Sessions 9 to 16 list the same two keys in opposite orders, the deadlock shape.
  FOR i IN 9..16 LOOP
    PERFORM dblink_send_query('rl_' || i, format(
      $q$SELECT allowed FROM public.rate_limit_take(ARRAY[decode(%L, 'hex'), decode(%L, 'hex')], ARRAY[100, 100], ARRAY[120, 120])$q$,
      CASE WHEN i % 2 = 0 THEN v_one ELSE v_two END,
      CASE WHEN i % 2 = 0 THEN v_two ELSE v_one END));
  END LOOP;

  -- A failed query, a deadlock included, raises here.
  FOR i IN 1..8 LOOP
    INSERT INTO rl_race SELECT allowed FROM dblink_get_result('rl_' || i) AS t(allowed boolean);
  END LOOP;
  FOR i IN 9..16 LOOP
    PERFORM allowed FROM dblink_get_result('rl_' || i) AS t(allowed boolean);
  END LOOP;

  FOR i IN 1..16 LOOP
    PERFORM dblink_disconnect('rl_' || i);
  END LOOP;
END $$;

SELECT is((SELECT count(*)::int FROM rl_race WHERE allowed), 5, 'eight concurrent takes against a limit of 5 allow exactly 5');
SELECT is(
  (SELECT hits FROM public.rate_limit_hits, rl_race_key WHERE key_hash = one AND window_seconds = 60),
  8, 'and lose no count');
SELECT is(
  (SELECT sum(hits)::int FROM public.rate_limit_hits, rl_race_key WHERE key_hash IN (one, two) AND window_seconds = 120),
  16, 'opposite-order takes on two keys all finish, with no deadlock');

SELECT * FROM finish();
ROLLBACK;
