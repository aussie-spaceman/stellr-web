-- pgTAP: platform_audit_events, the S4 hash-chained append-only audit log
-- (migration 20261104300000, docs/PLATFORM-AUDIT.md).
--
-- Runs in the `db` job of .github/workflows/ci.yml with the other files in
-- this directory. Covers: service_role cannot UPDATE, DELETE, TRUNCATE or
-- INSERT directly; the owner is refused by the triggers; chains verify; the
-- caller cannot supply chain values; a row tampered with by the owner (with
-- the guard trigger switched off inside this test) is caught by verification;
-- interleaved appends across chains keep every chain valid; and the canonical
-- form matches the golden vector lib/audit/platform.test.ts also checks.
--
-- CI's database is a superuser and the hosted one is not. Nothing here needs
-- superuser beyond what the table owner (postgres) can do on the hosted
-- project: ALTER TABLE … DISABLE TRIGGER on its own table.
BEGIN;
SET LOCAL search_path = extensions, public;

SELECT plan(71);

-- Test tenants: A and B for normal chains, C and D for tampering.
INSERT INTO public.tenants (id, slug, legal_name, display_name, country, payment_region, currency, time_zone) VALUES
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'pgtap-audit-a', 'Audit A', 'Audit A', 'US', 'US', 'usd', 'America/Denver'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'pgtap-audit-b', 'Audit B', 'Audit B', 'AU', 'AU', 'aud', 'Australia/Sydney'),
  ('cccccccc-0000-4000-8000-00000000000c', 'pgtap-audit-c', 'Audit C', 'Audit C', 'US', 'US', 'usd', 'America/Denver'),
  ('dddddddd-0000-4000-8000-00000000000d', 'pgtap-audit-d', 'Audit D', 'Audit D', 'US', 'US', 'usd', 'America/Denver');

-- ── 1. Shape and privileges ─────────────────────────────────────────────────
SELECT has_table('public', 'platform_audit_events', 'platform_audit_events exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.platform_audit_events'::regclass),
  'platform_audit_events has RLS enabled');
SELECT ok(has_table_privilege('service_role', 'public.platform_audit_events', 'SELECT'), 'service_role can read');
SELECT ok(NOT has_table_privilege('service_role', 'public.platform_audit_events', 'INSERT'), 'service_role holds no INSERT');
SELECT ok(NOT has_table_privilege('service_role', 'public.platform_audit_events', 'UPDATE'), 'service_role holds no UPDATE');
SELECT ok(NOT has_table_privilege('service_role', 'public.platform_audit_events', 'DELETE'), 'service_role holds no DELETE');
SELECT ok(NOT has_table_privilege('service_role', 'public.platform_audit_events', 'TRUNCATE'), 'service_role holds no TRUNCATE');
SELECT ok(NOT has_table_privilege('anon', 'public.platform_audit_events', 'SELECT')
          AND NOT has_table_privilege('authenticated', 'public.platform_audit_events', 'SELECT'),
  'anon and authenticated cannot read');
SELECT ok(NOT has_function_privilege('anon', 'public.platform_audit_append(uuid, text, text, text, text, text, text, jsonb)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.platform_audit_append(uuid, text, text, text, text, text, text, jsonb)', 'EXECUTE'),
  'anon and authenticated cannot append');
SELECT ok(has_function_privilege('service_role', 'public.platform_audit_append(uuid, text, text, text, text, text, text, jsonb)', 'EXECUTE'),
  'service_role can append');
SELECT ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc
    WHERE oid = 'public.platform_audit_append(uuid, text, text, text, text, text, text, jsonb)'::regprocedure),
  'platform_audit_append is SECURITY DEFINER with a pinned search_path');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'platform_audit%' AND prosecdef
               AND oid <> 'public.platform_audit_append(uuid, text, text, text, text, text, text, jsonb)'::regprocedure),
  'no other platform_audit function is SECURITY DEFINER');

-- ── 2. Appends as service_role, interleaved across three chains ─────────────
SET LOCAL ROLE service_role;
SELECT lives_ok(
  $q$SELECT public.platform_audit_append('aaaaaaaa-0000-4000-8000-00000000000a', 'user_pgtapA1', 'user', 'support.impersonate.start', 'members', '11111111-1111-4111-8111-111111111111', 'Help desk ticket', '{"ticket": 42}')$q$,
  'service_role appends through platform_audit_append');
DO $$
BEGIN
  PERFORM public.platform_audit_append(NULL, 'system', 'system', 'platform.tenant.provision', 'tenants', 'aaaaaaaa-0000-4000-8000-00000000000a');
  PERFORM public.platform_audit_append('aaaaaaaa-0000-4000-8000-00000000000a', 'user_pgtapA1', 'user', 'support.impersonate.stop', 'members', '11111111-1111-4111-8111-111111111111');
  PERFORM public.platform_audit_append('bbbbbbbb-0000-4000-8000-00000000000b', 'cron:apollo-reconcile', 'cron', 'cron.run.finish');
  PERFORM public.platform_audit_append(NULL, 'system', 'system', 'platform.flag.change', NULL, NULL, NULL, '{"flag": "x", "on": true}');
  PERFORM public.platform_audit_append('aaaaaaaa-0000-4000-8000-00000000000a', 'system', 'system', 'registration.refund.issue', 'registrations', 'r-1');
END $$;

SELECT throws_ok(
  $q$INSERT INTO public.platform_audit_events (tenant_id, actor, actor_kind, action, chain_seq, occurred_at, hash)
     VALUES (NULL, 'system', 'system', 'forged.insert', 1, now(), sha256('x'))$q$,
  '42501', NULL, 'service_role cannot INSERT directly');
SELECT throws_ok($q$UPDATE public.platform_audit_events SET reason = 'edited'$q$,
  '42501', NULL, 'service_role cannot UPDATE');
SELECT throws_ok($q$DELETE FROM public.platform_audit_events$q$,
  '42501', NULL, 'service_role cannot DELETE');
SELECT throws_ok($q$TRUNCATE public.platform_audit_events$q$,
  '42501', NULL, 'service_role cannot TRUNCATE');
SELECT is((SELECT count(*)::int FROM public.platform_audit_events WHERE tenant_id = 'aaaaaaaa-0000-4000-8000-00000000000a'),
  3, 'service_role can read the rows it appended');
RESET ROLE;


-- ── 3. The owner is refused by the triggers ─────────────────────────────────
SELECT throws_ok($q$UPDATE public.platform_audit_events SET reason = 'edited'$q$,
  'P0001', 'platform_audit_events is append-only (UPDATE refused)', 'the owner cannot UPDATE');
SELECT throws_ok($q$DELETE FROM public.platform_audit_events$q$,
  'P0001', 'platform_audit_events is append-only (DELETE refused)', 'the owner cannot DELETE');
SELECT throws_ok($q$TRUNCATE public.platform_audit_events$q$,
  'P0001', 'platform_audit_events is append-only (TRUNCATE refused)', 'the owner cannot TRUNCATE');

-- ── 4. Chain shape and verification ─────────────────────────────────────────
SELECT is(
  ARRAY(SELECT chain_seq FROM public.platform_audit_events WHERE tenant_id = 'aaaaaaaa-0000-4000-8000-00000000000a' ORDER BY id),
  ARRAY[1, 2, 3]::bigint[], 'tenant A has its own chain, numbered from 1');
SELECT is(
  ARRAY(SELECT chain_seq FROM public.platform_audit_events WHERE tenant_id IS NULL ORDER BY id),
  ARRAY[1, 2]::bigint[], 'the platform chain is separate');
SELECT ok(
  (SELECT prev_hash IS NULL FROM public.platform_audit_events WHERE tenant_id = 'aaaaaaaa-0000-4000-8000-00000000000a' AND chain_seq = 1),
  'the first row of a chain has no prev_hash');
SELECT is(
  (SELECT prev_hash FROM public.platform_audit_events WHERE tenant_id = 'aaaaaaaa-0000-4000-8000-00000000000a' AND chain_seq = 2),
  (SELECT hash FROM public.platform_audit_events WHERE tenant_id = 'aaaaaaaa-0000-4000-8000-00000000000a' AND chain_seq = 1),
  'each row links to the previous row of its own chain');
SELECT is(
  (SELECT hash FROM public.platform_audit_events WHERE tenant_id = 'aaaaaaaa-0000-4000-8000-00000000000a' AND chain_seq = 2),
  (SELECT public.platform_audit_digest(prev_hash, tenant_id, chain_seq, actor, actor_kind, action, target_table, target_id, reason, metadata, occurred_at)
     FROM public.platform_audit_events WHERE tenant_id = 'aaaaaaaa-0000-4000-8000-00000000000a' AND chain_seq = 2),
  'hash = sha256(prev_hash || canonical row)');
SELECT is((SELECT ok::text || '/' || checked FROM public.platform_audit_verify('aaaaaaaa-0000-4000-8000-00000000000a')),
  'true/3', 'tenant A verifies');
SELECT is((SELECT ok::text || '/' || checked FROM public.platform_audit_verify(NULL)),
  'true/2', 'the platform chain verifies');
SELECT is((SELECT ok::text || '/' || checked FROM public.platform_audit_verify('bbbbbbbb-0000-4000-8000-00000000000b')),
  'true/1', 'tenant B verifies');
SELECT is((SELECT ok::text || '/' || checked || '/' || head_seq FROM public.platform_audit_verify('cccccccc-0000-4000-8000-00000000000c')),
  'true/0/0', 'an empty chain verifies, with head 0');

-- ── 5. Callers cannot supply chain values ───────────────────────────────────
-- Even the owner, inserting directly with forged values, gets the computed ones.
INSERT INTO public.platform_audit_events (tenant_id, actor, actor_kind, action, chain_seq, prev_hash, hash, occurred_at)
VALUES ('aaaaaaaa-0000-4000-8000-00000000000a', 'system', 'system', 'forged.values', 99,
        sha256('forged-prev'), sha256('forged'), '2000-01-01T00:00:00Z');
SELECT is(
  (SELECT chain_seq FROM public.platform_audit_events WHERE action = 'forged.values'), 4::bigint,
  'a supplied chain_seq is replaced with the next in the chain');
SELECT ok(
  (SELECT hash <> sha256('forged') AND prev_hash <> sha256('forged-prev') AND occurred_at > '2020-01-01'
     FROM public.platform_audit_events WHERE action = 'forged.values'),
  'a supplied hash, prev_hash and occurred_at are replaced');
SELECT is((SELECT ok FROM public.platform_audit_verify('aaaaaaaa-0000-4000-8000-00000000000a')), true,
  'tenant A still verifies after the forged insert');

-- ── 6. Constraints keep personal data and junk out ──────────────────────────
SELECT throws_ok($q$SELECT public.platform_audit_append(NULL, 'not-an-actor', 'user', 'a.b')$q$,
  '23514', NULL, 'a user actor must be a Clerk user id');
SELECT throws_ok($q$SELECT public.platform_audit_append(NULL, 'system', 'system', 'NoDots')$q$,
  '23514', NULL, 'action must be dotted lower-case');
SELECT throws_ok($q$SELECT public.platform_audit_append(NULL, 'system', 'system', 'a.b', 'members', 'someone@example.test')$q$,
  '23514', NULL, 'target_id cannot hold an email address');
SELECT throws_ok($q$SELECT public.platform_audit_append(NULL, 'system', 'system', 'a.b', NULL, NULL, NULL, '[1, 2]')$q$,
  '23514', NULL, 'metadata must be an object');

-- ── 7. Golden vector (lib/audit/platform.test.ts checks the same values) ────
SELECT is(
  public.platform_audit_canonical('00000000-0000-4000-8000-000000000001', 1, 'user_abc123', 'user',
    'support.impersonate.start', 'members', '11111111-1111-4111-8111-111111111111',
    'Ticket 42 ' || chr(8211) || ' check', '{"b": 1, "a": "x"}', '2026-11-04T10:00:00.123Z'),
  'pae1|36:00000000-0000-4000-8000-000000000001|1:1|11:user_abc123|4:user|25:support.impersonate.start|7:members|36:11111111-1111-4111-8111-111111111111|19:Ticket 42 ' || chr(8211) || ' check|18:{"a": "x", "b": 1}|24:2026-11-04T10:00:00.123Z',
  'canonical form matches the golden vector (byte-length prefixes, sorted jsonb)');
SELECT is(
  encode(public.platform_audit_digest(NULL, '00000000-0000-4000-8000-000000000001', 1, 'user_abc123', 'user',
    'support.impersonate.start', 'members', '11111111-1111-4111-8111-111111111111',
    'Ticket 42 ' || chr(8211) || ' check', '{"b": 1, "a": "x"}', '2026-11-04T10:00:00.123Z'), 'hex'),
  'b5015758ffdab53c2e415bfd74f7f47a993105847a36702553594af1a92fe423',
  'genesis digest matches the golden vector');
SELECT is(
  encode(public.platform_audit_digest(decode('b5015758ffdab53c2e415bfd74f7f47a993105847a36702553594af1a92fe423', 'hex'),
    NULL, 2, 'system', 'system', 'platform.test.event', NULL, NULL, NULL, '{}', '2026-11-04T10:00:01Z'), 'hex'),
  '0d460bd020cefade5ab5f355269d0abbe9b7ed1172d2684a79c6f534773384b9',
  'chained digest matches the golden vector');

-- ── 8. Tampering by the owner is detected ───────────────────────────────────
SET LOCAL ROLE service_role;
DO $$
BEGIN
  PERFORM public.platform_audit_append('cccccccc-0000-4000-8000-00000000000c', 'system', 'system', 'tamper.test.one');
  PERFORM public.platform_audit_append('cccccccc-0000-4000-8000-00000000000c', 'system', 'system', 'tamper.test.two', NULL, NULL, 'original reason');
  PERFORM public.platform_audit_append('cccccccc-0000-4000-8000-00000000000c', 'system', 'system', 'tamper.test.three');
  PERFORM public.platform_audit_append('dddddddd-0000-4000-8000-00000000000d', 'system', 'system', 'delete.test.one');
  PERFORM public.platform_audit_append('dddddddd-0000-4000-8000-00000000000d', 'system', 'system', 'delete.test.two');
  PERFORM public.platform_audit_append('dddddddd-0000-4000-8000-00000000000d', 'system', 'system', 'delete.test.three');
END $$;
RESET ROLE;
SELECT is((SELECT ok FROM public.platform_audit_verify('cccccccc-0000-4000-8000-00000000000c')), true, 'tenant C verifies before tampering');

ALTER TABLE public.platform_audit_events DISABLE TRIGGER platform_audit_events_no_update_delete;
UPDATE public.platform_audit_events SET reason = 'rewritten reason'
 WHERE tenant_id = 'cccccccc-0000-4000-8000-00000000000c' AND chain_seq = 2;
DELETE FROM public.platform_audit_events
 WHERE tenant_id = 'dddddddd-0000-4000-8000-00000000000d' AND chain_seq = 2;
ALTER TABLE public.platform_audit_events ENABLE TRIGGER platform_audit_events_no_update_delete;

SELECT is(
  (SELECT ok::text || '/' || first_bad_seq || '/' || problem FROM public.platform_audit_verify('cccccccc-0000-4000-8000-00000000000c')),
  'false/2/hash does not match the row', 'an edited row is detected at its position');
SELECT is(
  (SELECT ok::text || '/' || first_bad_seq || '/' || problem FROM public.platform_audit_verify('dddddddd-0000-4000-8000-00000000000d')),
  'false/3/sequence gap', 'a deleted row is detected as a gap');

-- Re-linking the next row to hide a deletion breaks its hash instead.
ALTER TABLE public.platform_audit_events DISABLE TRIGGER platform_audit_events_no_update_delete;
UPDATE public.platform_audit_events
   SET chain_seq = 2,
       prev_hash = (SELECT hash FROM public.platform_audit_events WHERE tenant_id = 'dddddddd-0000-4000-8000-00000000000d' AND chain_seq = 1)
 WHERE tenant_id = 'dddddddd-0000-4000-8000-00000000000d' AND chain_seq = 3;
ALTER TABLE public.platform_audit_events ENABLE TRIGGER platform_audit_events_no_update_delete;
SELECT is(
  (SELECT ok::text || '/' || first_bad_seq || '/' || problem FROM public.platform_audit_verify('dddddddd-0000-4000-8000-00000000000d')),
  'false/2/hash does not match the row', 'renumbering and re-linking to hide a deletion is detected');

SELECT is((SELECT ok FROM public.platform_audit_verify('aaaaaaaa-0000-4000-8000-00000000000a')), true,
  'tampering with one tenant''s chain leaves the others verifiable');

-- The unique (tenant_id, chain_seq) backstop: a second row claiming an
-- occupied position is refused, so a chain cannot fork.
ALTER TABLE public.platform_audit_events DISABLE TRIGGER platform_audit_events_chain;
SELECT throws_ok(
  $q$INSERT INTO public.platform_audit_events (tenant_id, chain_seq, actor, actor_kind, action, occurred_at, prev_hash, hash)
     VALUES ('aaaaaaaa-0000-4000-8000-00000000000a', 2, 'system', 'system', 'fork.attempt', now(), sha256('p'), sha256('h'))$q$,
  '23505', NULL, 'a second row at an occupied chain position is refused (no fork)');
SELECT throws_ok(
  $q$INSERT INTO public.platform_audit_events (tenant_id, chain_seq, actor, actor_kind, action, occurred_at, prev_hash, hash)
     VALUES (NULL, 1, 'system', 'system', 'fork.attempt', now(), NULL, sha256('h'))$q$,
  '23505', NULL, 'the platform chain (NULL tenant) has the same backstop');
ALTER TABLE public.platform_audit_events ENABLE TRIGGER platform_audit_events_chain;

SELECT is(
  (SELECT count(*)::int FROM pg_trigger WHERE tgrelid = 'public.platform_audit_events'::regclass AND NOT tgisinternal AND tgenabled = 'O'),
  3, 'all three platform_audit_events triggers are enabled again');

-- ── 9. Many interleaved appends (sequential simulation of concurrency) ──────
SET LOCAL ROLE service_role;
DO $$
BEGIN
  FOR i IN 1..30 LOOP
    PERFORM public.platform_audit_append(
      CASE i % 3 WHEN 0 THEN NULL WHEN 1 THEN 'aaaaaaaa-0000-4000-8000-00000000000a'::uuid ELSE 'bbbbbbbb-0000-4000-8000-00000000000b'::uuid END,
      'cron:interleave', 'cron', 'test.interleave.step', NULL, NULL, NULL, jsonb_build_object('i', i));
  END LOOP;
END $$;
RESET ROLE;
SELECT is((SELECT ok::text || '/' || checked || '/' || head_seq FROM public.platform_audit_verify('aaaaaaaa-0000-4000-8000-00000000000a')),
  'true/14/14', 'tenant A: 4 earlier + 10 interleaved, contiguous and valid');
SELECT is((SELECT ok::text || '/' || checked || '/' || head_seq FROM public.platform_audit_verify('bbbbbbbb-0000-4000-8000-00000000000b')),
  'true/11/11', 'tenant B: 1 earlier + 10 interleaved, contiguous and valid');
SELECT is((SELECT ok::text || '/' || checked || '/' || head_seq FROM public.platform_audit_verify(NULL)),
  'true/12/12', 'platform chain: 2 earlier + 10 interleaved, contiguous and valid');

-- ── 10. Heads ───────────────────────────────────────────────────────────────
SELECT is(
  (SELECT chain_seq FROM public.platform_audit_heads() WHERE tenant_id = 'aaaaaaaa-0000-4000-8000-00000000000a'),
  14::bigint, 'heads report the newest row of tenant A');
SELECT is(
  (SELECT h.hash FROM public.platform_audit_heads() h WHERE h.tenant_id IS NULL),
  (SELECT head_hash FROM public.platform_audit_verify(NULL)),
  'heads and verify agree on the platform chain head');
SELECT is((SELECT count(*)::int FROM public.platform_audit_heads()), 5, 'one head per chain (A, B, C, D, platform)');

-- ── 11. The webhook actor (migration 20261105052154) ────────────────────────
SET LOCAL ROLE service_role;
SELECT lives_ok(
  $q$SELECT public.platform_audit_append('aaaaaaaa-0000-4000-8000-00000000000a', 'webhook:stripe', 'webhook', 'webhook.event.process')$q$,
  'service_role appends a webhook actor');
SELECT lives_ok(
  $q$SELECT public.platform_audit_append('aaaaaaaa-0000-4000-8000-00000000000a', 'webhook:docu_sign-2', 'webhook', 'webhook.event.process')$q$,
  'a provider may hold digits, an underscore and a hyphen');
SELECT lives_ok(
  $q$SELECT public.platform_audit_append('aaaaaaaa-0000-4000-8000-00000000000a', 'webhook:' || repeat('a', 32), 'webhook', 'webhook.event.process')$q$,
  'a provider may be 32 characters');
SELECT throws_ok($q$SELECT public.platform_audit_append(NULL, 'webhook:' || repeat('a', 33), 'webhook', 'a.b')$q$,
  '23514', NULL, 'a provider may not be 33 characters');
SELECT throws_ok($q$SELECT public.platform_audit_append(NULL, 'webhook:', 'webhook', 'a.b')$q$,
  '23514', NULL, 'a provider may not be empty');
SELECT throws_ok($q$SELECT public.platform_audit_append(NULL, 'webhook:Stripe', 'webhook', 'a.b')$q$,
  '23514', NULL, 'a provider is lower-case');
SELECT throws_ok($q$SELECT public.platform_audit_append(NULL, 'webhook:a.b', 'webhook', 'a.b')$q$,
  '23514', NULL, 'a provider holds no dot');
SELECT throws_ok($q$SELECT public.platform_audit_append(NULL, 'stripe', 'webhook', 'a.b')$q$,
  '23514', NULL, 'a webhook actor carries the webhook: prefix');
SELECT throws_ok($q$SELECT public.platform_audit_append(NULL, 'webhook:stripe', 'user', 'a.b')$q$,
  '23514', NULL, 'a webhook actor cannot claim to be a user');
SELECT throws_ok($q$SELECT public.platform_audit_append(NULL, 'webhook:stripe', 'cron', 'a.b')$q$,
  '23514', NULL, 'a webhook actor cannot claim to be a cron');
SELECT throws_ok($q$SELECT public.platform_audit_append(NULL, 'user_abc123', 'webhook', 'a.b')$q$,
  '23514', NULL, 'a user id cannot claim to be a webhook');
SELECT throws_ok($q$SELECT public.platform_audit_append(NULL, 'system', 'other', 'a.b')$q$,
  '23514', NULL, 'an unknown actor kind is still refused');
RESET ROLE;
SELECT is((SELECT ok::text || '/' || checked || '/' || head_seq FROM public.platform_audit_verify('aaaaaaaa-0000-4000-8000-00000000000a')),
  'true/17/17', 'the chain verifies across rows with a webhook actor');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.platform_audit_events'::regclass
               AND conname IN ('platform_audit_events_actor_kind_check', 'platform_audit_events_actor_check') AND NOT convalidated),
  'both actor constraints are validated');
SELECT is(
  encode(public.platform_audit_digest(NULL, NULL, 1, 'webhook:stripe', 'webhook', 'webhook.event.process', NULL, NULL, NULL, '{}', '2026-11-05T10:00:00Z'), 'hex'),
  'fc9b66570852b4d5110052aed974cec4a9d7665fb23a0b06cbb2197761ec9767',
  'a webhook row''s digest matches the golden vector lib/audit/platform.test.ts checks');

-- ── The row lib/cron-audit.ts writes: a run spans tenants, so the platform chain ──
SET LOCAL ROLE service_role;
SELECT lives_ok(
  $q$SELECT public.platform_audit_append(NULL, 'cron:team-profiles', 'cron', 'cron.run.finish', NULL, NULL, NULL, '{"status": 200}')$q$,
  'a cron run''s event goes on the platform chain');
RESET ROLE;
SELECT is((SELECT ok FROM public.platform_audit_verify(NULL)), true,
  'the platform chain verifies across a cron row');

SELECT * FROM finish();
ROLLBACK;
