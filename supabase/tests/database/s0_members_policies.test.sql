-- pgTAP: S0-members-policies (20261114030947_s0_members_policies.sql). Runs in
-- the CI `db` job against a database built from supabase/baseline.sql + every
-- timestamped migration. Everything rolls back.
--
--   1. members: the three legacy policies are gone, no permissive policy
--      reaches an API role, and the restrictive cap is in place.
--   2. The RLS helpers: SECURITY DEFINER, search_path pinned to '', anon
--      cannot execute them, authenticated and service_role can.
--   3. tenant_isolation / tenant_isolation_guard are still on the tenant tables.
--   4. Behaviour, with request.jwt.claims set as Supabase sets them for a
--      Clerk session: a member reads no members row (the app never reads
--      members client-side), not even their own, and cannot update it; anon
--      reads nothing; a member of Space X reads X's chat and not Y's; deleted
--      messages stay hidden; the helpers answer only about the caller; the
--      cohort branch honours archiving and the mentor capability.
--
-- Fixture ids and Clerk subs are made up for this file.
BEGIN;
SET LOCAL search_path = extensions, public;

SELECT plan(49);

-- ── 1. members policies ──────────────────────────────────────────────────────

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.members'::regclass),
  'members: row level security is still enabled');
SELECT is_empty($q$
  SELECT policyname FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'members'
    AND policyname IN ('members_admin_all', 'members_self_read', 'members_self_update')
$q$, 'members: the legacy members_admin_all, members_self_read and members_self_update are gone');
SELECT is_empty($q$
  SELECT policyname FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'members'
    AND permissive = 'PERMISSIVE'
    AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
$q$, 'members: no permissive policy reaches PUBLIC, anon or authenticated');
SELECT ok((
  SELECT permissive = 'RESTRICTIVE' AND cmd = 'ALL'
     AND roles @> ARRAY['anon', 'authenticated']::name[] AND cardinality(roles) = 2
     AND qual = 'false' AND with_check = 'false'
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'members' AND policyname = 'members_no_api_access'
), 'members: members_no_api_access is RESTRICTIVE FOR ALL TO anon, authenticated, USING false WITH CHECK false');

-- ── 2. The RLS helpers ───────────────────────────────────────────────────────

CREATE TEMP TABLE s0_helpers (sig regprocedure PRIMARY KEY);
INSERT INTO s0_helpers VALUES
  ('public.can_read_space(uuid, text)'),
  ('public.can_read_chat_channel(uuid, text)'),
  ('public.survey_current_member_id()');

SELECT is((SELECT count(*)::int FROM s0_helpers h JOIN pg_proc p ON p.oid = h.sig WHERE p.prosecdef), 3,
  'helpers: all three are still SECURITY DEFINER');
SELECT is((SELECT count(*)::int FROM s0_helpers h JOIN pg_proc p ON p.oid = h.sig WHERE 'search_path=""' = ANY (p.proconfig)), 3,
  'helpers: all three pin search_path to an empty path');
SELECT is((SELECT count(*)::int FROM s0_helpers WHERE has_function_privilege('anon', sig, 'EXECUTE')), 0,
  'helpers: anon can execute none of them');
SELECT is((SELECT count(*)::int FROM s0_helpers WHERE has_function_privilege('authenticated', sig, 'EXECUTE')), 3,
  'helpers: authenticated can execute all three (their policies call them)');
SELECT is((SELECT count(*)::int FROM s0_helpers WHERE has_function_privilege('service_role', sig, 'EXECUTE')), 3,
  'helpers: service_role can execute all three');

-- The chat policy is the only permissive one reaching an API role.
SELECT is((
  SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'chat_messages'
    AND permissive = 'PERMISSIVE'
    AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
), ARRAY['members read own channel messages'],
  'chat_messages: "members read own channel messages" is the only permissive policy for API roles');
SELECT ok((
  SELECT cmd = 'SELECT' AND roles = ARRAY['authenticated']::name[]
     AND qual LIKE '%deleted_at IS NULL%' AND qual LIKE '%can_read_chat_channel%'
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'chat_messages' AND policyname = 'members read own channel messages'
), 'chat_messages: the policy is SELECT TO authenticated, hides deleted rows and calls can_read_chat_channel');

-- ── 3. Tenant isolation is untouched ─────────────────────────────────────────

SELECT cmp_ok((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND policyname = 'tenant_isolation'), '>=', 35,
  'tenant_isolation: still on at least 35 public tables');
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND policyname = 'tenant_isolation_guard'),
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND policyname = 'tenant_isolation'),
  'tenant_isolation_guard: on every table that has tenant_isolation');
SELECT is_empty($q$
  SELECT tablename FROM pg_policies
  WHERE schemaname = 'public' AND policyname IN ('tenant_isolation', 'tenant_isolation_guard')
    AND roles <> ARRAY['tenant_app']::name[]
$q$, 'tenant_isolation policies: still TO tenant_app only');

-- ── 4. Fixtures ──────────────────────────────────────────────────────────────
-- A: member of private Space X, coachee of a coaching channel.
-- B: member of private Space Y, roster member of a cohort.
-- M: the cohort's mentor (also the coaching host).
INSERT INTO public.members (id, first_name, last_name, email, event_role, clerk_user_id) VALUES
  ('d5000000-0000-4000-8000-00000000000a', 'S0', 'Alpha', 's0-alpha@example.test', 'participant', 'user_s0pgtap_alpha'),
  ('d5000000-0000-4000-8000-00000000000b', 'S0', 'Bravo', 's0-bravo@example.test', 'participant', 'user_s0pgtap_bravo'),
  ('d5000000-0000-4000-8000-00000000000c', 'S0', 'Mentor', 's0-mentor@example.test', 'mentor', 'user_s0pgtap_mentor');

INSERT INTO public.community_spaces (id, slug, name, access_type) VALUES
  ('d5000000-0000-4000-8000-0000000000a1', 's0-pgtap-space-x', 'S0 Space X', 'private'),
  ('d5000000-0000-4000-8000-0000000000b1', 's0-pgtap-space-y', 'S0 Space Y', 'private');
INSERT INTO public.community_space_members (space_id, member_id, status) VALUES
  ('d5000000-0000-4000-8000-0000000000a1', 'd5000000-0000-4000-8000-00000000000a', 'active'),
  ('d5000000-0000-4000-8000-0000000000b1', 'd5000000-0000-4000-8000-00000000000b', 'active');

INSERT INTO public.mentoring_cohorts (id, name, mentor_member_id) VALUES
  ('d5000000-0000-4000-8000-0000000000c1', 'S0 Cohort', 'd5000000-0000-4000-8000-00000000000c');
INSERT INTO public.cohort_members (cohort_id, member_id, status) VALUES
  ('d5000000-0000-4000-8000-0000000000c1', 'd5000000-0000-4000-8000-00000000000b', 'active');

INSERT INTO public.chat_channels (id, kind, space_id, cohort_id, member_id, host_member_id) VALUES
  ('d5000000-0000-4000-8000-000000000ca1', 'space', 'd5000000-0000-4000-8000-0000000000a1', NULL, NULL, NULL),
  ('d5000000-0000-4000-8000-000000000cb1', 'space', 'd5000000-0000-4000-8000-0000000000b1', NULL, NULL, NULL),
  ('d5000000-0000-4000-8000-000000000cc1', 'cohort', NULL, 'd5000000-0000-4000-8000-0000000000c1', NULL, NULL),
  ('d5000000-0000-4000-8000-000000000cd1', 'coaching', NULL, NULL, 'd5000000-0000-4000-8000-00000000000a', 'd5000000-0000-4000-8000-00000000000c');

INSERT INTO public.chat_messages (channel_id, author_member_id, body, deleted_at) VALUES
  ('d5000000-0000-4000-8000-000000000ca1', 'd5000000-0000-4000-8000-00000000000a', 'X live', NULL),
  ('d5000000-0000-4000-8000-000000000ca1', 'd5000000-0000-4000-8000-00000000000a', 'X removed', now()),
  ('d5000000-0000-4000-8000-000000000cb1', 'd5000000-0000-4000-8000-00000000000b', 'Y live', NULL),
  ('d5000000-0000-4000-8000-000000000cc1', 'd5000000-0000-4000-8000-00000000000b', 'Cohort live', NULL),
  ('d5000000-0000-4000-8000-000000000cd1', 'd5000000-0000-4000-8000-00000000000a', 'Coaching live', NULL);

-- Rows the current role can see. A refused privilege counts as none seen:
-- either way the caller reads nothing (the table grants are a separate S0 item).
CREATE FUNCTION pg_temp.seen(p_sql text) RETURNS int LANGUAGE plpgsql AS $f$
DECLARE n int;
BEGIN
  EXECUTE 'SELECT count(*)::int FROM (' || p_sql || ') s' INTO n;
  RETURN n;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN 0;
END
$f$;
-- Rows the current role changed, the same way.
CREATE FUNCTION pg_temp.changed(p_sql text) RETURNS int LANGUAGE plpgsql AS $f$
DECLARE n int;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN 0;
END
$f$;
CREATE FUNCTION pg_temp.chat(p_channel uuid) RETURNS int LANGUAGE sql AS $f$
  SELECT pg_temp.seen(format('SELECT 1 FROM public.chat_messages WHERE channel_id = %L', p_channel))
$f$;
GRANT EXECUTE ON FUNCTION pg_temp.seen(text), pg_temp.changed(text), pg_temp.chat(uuid) TO anon, authenticated;

-- ── 5. Member A ──────────────────────────────────────────────────────────────
SET LOCAL request.jwt.claims TO '{"sub":"user_s0pgtap_alpha","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(pg_temp.seen('SELECT 1 FROM public.members'), 0,
  'A: reads no members row at all');
SELECT is(pg_temp.seen($$SELECT 1 FROM public.members WHERE clerk_user_id = 'user_s0pgtap_alpha'$$), 0,
  'A: reads not even their own members row (the app never reads members client-side)');
SELECT is(pg_temp.changed($$UPDATE public.members SET is_active = true WHERE clerk_user_id = 'user_s0pgtap_alpha'$$), 0,
  'A: cannot update their own members row');
SELECT is(pg_temp.chat('d5000000-0000-4000-8000-000000000ca1'), 1,
  'A: reads Space X''s live chat message, and not the removed one');
SELECT is(pg_temp.chat('d5000000-0000-4000-8000-000000000cb1'), 0,
  'A: reads none of Space Y''s chat');
SELECT is(pg_temp.chat('d5000000-0000-4000-8000-000000000cd1'), 1,
  'A: reads their coaching channel');
SELECT is(pg_temp.chat('d5000000-0000-4000-8000-000000000cc1'), 0,
  'A: reads none of a cohort they are not on');
SELECT ok(public.can_read_chat_channel('d5000000-0000-4000-8000-000000000ca1', 'user_s0pgtap_alpha'),
  'A: can_read_chat_channel answers for A');
SELECT ok(NOT public.can_read_chat_channel('d5000000-0000-4000-8000-000000000cb1', 'user_s0pgtap_bravo'),
  'A: can_read_chat_channel will not answer about B, even for a channel B can read');
SELECT ok(NOT public.can_read_space('d5000000-0000-4000-8000-0000000000b1', 'user_s0pgtap_bravo'),
  'A: can_read_space will not answer about B, even for a Space B can read');
SELECT is(public.survey_current_member_id(), 'd5000000-0000-4000-8000-00000000000a'::uuid,
  'A: survey_current_member_id still resolves the caller');

RESET ROLE;

-- ── 6. Member B ──────────────────────────────────────────────────────────────
SET LOCAL request.jwt.claims TO '{"sub":"user_s0pgtap_bravo","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(pg_temp.chat('d5000000-0000-4000-8000-000000000cb1'), 1,
  'B: reads Space Y''s chat');
SELECT is(pg_temp.chat('d5000000-0000-4000-8000-000000000ca1'), 0,
  'B: reads none of Space X''s chat');
SELECT is(pg_temp.chat('d5000000-0000-4000-8000-000000000cc1'), 1,
  'B: reads the cohort chat they are on');
SELECT is(pg_temp.chat('d5000000-0000-4000-8000-000000000cd1'), 0,
  'B: reads none of a coaching channel they are not in');
SELECT is(pg_temp.seen('SELECT 1 FROM public.members'), 0,
  'B: reads no members row');

RESET ROLE;

-- ── 7. The cohort branch: mentor capability and archiving ────────────────────
SET LOCAL request.jwt.claims TO '{"sub":"user_s0pgtap_mentor","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.chat('d5000000-0000-4000-8000-000000000cc1'), 0,
  'mentor without the mentor capability: reads none of the cohort chat');
SELECT is(pg_temp.chat('d5000000-0000-4000-8000-000000000cd1'), 1,
  'mentor: reads the coaching channel they host');
RESET ROLE;

INSERT INTO public.session_hosts (member_id, can_mentor) VALUES ('d5000000-0000-4000-8000-00000000000c', true);
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.chat('d5000000-0000-4000-8000-000000000cc1'), 1,
  'mentor with the mentor capability: reads the cohort chat');
RESET ROLE;

UPDATE public.mentoring_cohorts SET lifecycle = 'archived', archived_at = now() WHERE id = 'd5000000-0000-4000-8000-0000000000c1';
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.chat('d5000000-0000-4000-8000-000000000cc1'), 0,
  'archived cohort (re-gated): the mentor reads none of its chat');
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"sub":"user_s0pgtap_bravo","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.chat('d5000000-0000-4000-8000-000000000cc1'), 0,
  'archived cohort (re-gated): a roster member reads none of its chat');
RESET ROLE;

INSERT INTO public.content_persistence (target_type, target_ref, policy)
  VALUES ('container', 'd5000000-0000-4000-8000-0000000000c1', 'keep_open');
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.chat('d5000000-0000-4000-8000-000000000cc1'), 1,
  'archived cohort kept open: a roster member reads its chat again');
RESET ROLE;

-- ── 8. A deactivated member reads nothing ────────────────────────────────────
UPDATE public.members SET is_active = false WHERE id = 'd5000000-0000-4000-8000-00000000000a';
SET LOCAL request.jwt.claims TO '{"sub":"user_s0pgtap_alpha","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.chat('d5000000-0000-4000-8000-000000000ca1'), 0,
  'deactivated A: reads none of Space X''s chat');
SELECT is(pg_temp.chat('d5000000-0000-4000-8000-000000000cd1'), 0,
  'deactivated A: reads none of their coaching channel');
RESET ROLE;
UPDATE public.members SET is_active = true WHERE id = 'd5000000-0000-4000-8000-00000000000a';

-- ── 9. A Space suspension closes Space chat ──────────────────────────────────
INSERT INTO public.community_space_suspensions (space_id, member_id, scope)
  VALUES ('d5000000-0000-4000-8000-0000000000a1', 'd5000000-0000-4000-8000-00000000000a', 'access');
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.chat('d5000000-0000-4000-8000-000000000ca1'), 0,
  'A suspended from Space X: reads none of its chat');
RESET ROLE;

-- ── 10. anon ─────────────────────────────────────────────────────────────────
SET LOCAL request.jwt.claims TO '{"role":"anon"}';
SET LOCAL ROLE anon;
SELECT is(pg_temp.seen('SELECT 1 FROM public.members'), 0,
  'anon: reads no members row');
SELECT is(pg_temp.changed($$UPDATE public.members SET is_active = true$$), 0,
  'anon: updates no members row');
SELECT is(pg_temp.seen('SELECT 1 FROM public.chat_messages'), 0,
  'anon: reads no chat message');
SELECT throws_ok($q$SELECT public.can_read_chat_channel('d5000000-0000-4000-8000-000000000ca1', 'user_s0pgtap_alpha')$q$,
  '42501', NULL, 'anon: cannot execute can_read_chat_channel');
SELECT throws_ok($q$SELECT public.can_read_space('d5000000-0000-4000-8000-0000000000a1', 'user_s0pgtap_alpha')$q$,
  '42501', NULL, 'anon: cannot execute can_read_space');
SELECT throws_ok($q$SELECT public.survey_current_member_id()$q$,
  '42501', NULL, 'anon: cannot execute survey_current_member_id');
RESET ROLE;

-- ── 11. Direct sessions (no JWT) still get answers about anyone ──────────────
SET LOCAL request.jwt.claims TO '';
SELECT ok(public.can_read_chat_channel('d5000000-0000-4000-8000-000000000cb1', 'user_s0pgtap_bravo'),
  'no JWT: can_read_chat_channel answers about B (server and maintenance callers)');
SELECT ok(public.can_read_space('d5000000-0000-4000-8000-0000000000b1', 'user_s0pgtap_bravo'),
  'no JWT: can_read_space answers about B');
SELECT ok(NOT public.can_read_space('d5000000-0000-4000-8000-0000000000a1', 'user_s0pgtap_bravo'),
  'no JWT: can_read_space still refuses B on Space X');
SELECT ok(NOT public.can_read_chat_channel('d5000000-0000-4000-8000-000000000ca1', NULL),
  'no JWT: a NULL Clerk id reads nothing');

SELECT * FROM finish();
ROLLBACK;
