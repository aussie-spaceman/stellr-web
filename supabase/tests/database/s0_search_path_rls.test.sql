-- pgTAP: S0-3 search_path pinning and RLS policy-or-deny (multi-tenancy plan S0).
--
-- Runs in the `db` job of .github/workflows/ci.yml, against an ephemeral
-- database built from supabase/baseline.sql plus every timestamped migration.
-- Covers the two migrations
--   20261114030704_s0_pin_search_path.sql  (10 functions get search_path = '')
--   20261114030711_s0_rls_policies.sql     (22 tables get the explicit-deny comment)
-- and is the pgTAP twin of the two S0-3 checks in
-- supabase/tests/security_checks.sql (search_path_mutable, rls_no_policy).
-- Keep the queries below in step with that file. Everything rolls back.
BEGIN;
SET LOCAL search_path = extensions, public;

SELECT plan(75);

-- The two S0-3 checks, unconditional (security_checks.sql arms them on the
-- deny marker; here the database has both migrations, so they always run).
-- Kept as text so the same query runs against the real schema (must return
-- nothing) and against probe objects at the end (must return exactly those).
CREATE TEMP TABLE s0_checks (name text PRIMARY KEY, query text NOT NULL);
INSERT INTO s0_checks VALUES
  ('search_path_mutable', $q$
    SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'entitlements')
      AND p.prokind IN ('f', 'p')
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) AS cfg
        WHERE starts_with(cfg, 'search_path=')
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
      )
  $q$),
  ('rls_no_policy', $q$
    SELECT n.nspname || '.' || c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'entitlements')
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
      AND NOT EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = c.oid)
      AND NOT coalesce(starts_with(obj_description(c.oid, 'pg_class'),
                                   'RLS on, no policy: service_role only (S0-3)'), false)
  $q$);

-- Guards against a vacuous pass: an empty database also has no findings.
SELECT cmp_ok(
  (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public'), '>=', 100,
  'the baseline loaded: public has at least 100 tables'
);

-- security_checks.sql reports the S0-3 findings only once a table carries the
-- deny marker. On a database with both migrations it must be armed, or the
-- production checks would be silently off.
SELECT ok(EXISTS (
  SELECT 1
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'entitlements')
    AND starts_with(obj_description(c.oid, 'pg_class'), 'RLS on, no policy: service_role only (S0-3)')
), 'security_checks.sql S0-3 checks are armed (a table carries the explicit-deny marker)');

-- ── 1. search_path ───────────────────────────────────────────────────────────
-- The 10 functions S0-3 pinned: each has search_path set to the empty string.
-- A missing function fails the cast.
WITH fns(sig) AS (
  VALUES
    ('public.esign_templates_freeze()'),
    ('public.esign_audit_digest(text, uuid, uuid, text, timestamptz, text, text, jsonb)'),
    ('public.esign_audit_events_guard()'),
    ('public.esign_audit_heads()'),
    ('public.survey_definitions_freeze()'),
    ('public.survey_distributions_close_date()'),
    ('public.survey_responses_freeze()'),
    ('public.survey_answers_immutable()'),
    ('public.survey_answers_insert_guard()'),
    ('public.survey_access_log_append_only()')
)
SELECT ok(
  'search_path=""' = ANY (coalesce(p.proconfig, '{}'::text[])),
  fns.sig || ' pins search_path to empty'
)
FROM fns
JOIN pg_proc p ON p.oid = fns.sig::regprocedure
ORDER BY fns.sig;

SELECT is_empty((SELECT query FROM s0_checks WHERE name = 'search_path_mutable'),
  'every function in public and entitlements (not extension-owned) sets its own search_path');

-- ── 2. RLS: a policy or the explicit deny ────────────────────────────────────
-- The 22 tables S0-3 recorded as service_role only: RLS still on, still no
-- policy (anon and authenticated stay refused), and the marker comment.
WITH tbls(name) AS (
  VALUES
    ('entitlements.account_credit_ledger'), ('entitlements.bookings'),
    ('entitlements.coupon_redemptions'), ('entitlements.discounts'),
    ('entitlements.entitlements'), ('entitlements.member_grant_runs'),
    ('entitlements.offerings'), ('entitlements.prices'),
    ('entitlements.processed_events'), ('entitlements.tier_benefits'),
    ('entitlements.tiers'),
    ('public.audit_log'), ('public.crawler_hits'),
    ('public.lead_capture_failures'), ('public.member_memberships'),
    ('public.member_pending_consent'), ('public.member_schools'),
    ('public.membership_tiers'), ('public.recording_offloads'),
    ('public.schools'), ('public.stripe_webhook_events'),
    ('public.video_watermark_jobs')
)
SELECT ok(
  c.relrowsecurity
    AND NOT EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = c.oid)
    AND coalesce(starts_with(obj_description(c.oid, 'pg_class'),
                             'RLS on, no policy: service_role only (S0-3)'), false),
  tbls.name || ': RLS on, no policy, explicit-deny comment'
)
FROM tbls
JOIN pg_class c ON c.oid = tbls.name::regclass
ORDER BY tbls.name;

-- service_role still reads every one of them: it holds SELECT and the schema's
-- USAGE, and it bypasses RLS, so no policy is needed for it.
WITH tbls(name) AS (
  VALUES
    ('entitlements.account_credit_ledger'), ('entitlements.bookings'),
    ('entitlements.coupon_redemptions'), ('entitlements.discounts'),
    ('entitlements.entitlements'), ('entitlements.member_grant_runs'),
    ('entitlements.offerings'), ('entitlements.prices'),
    ('entitlements.processed_events'), ('entitlements.tier_benefits'),
    ('entitlements.tiers'),
    ('public.audit_log'), ('public.crawler_hits'),
    ('public.lead_capture_failures'), ('public.member_memberships'),
    ('public.member_pending_consent'), ('public.member_schools'),
    ('public.membership_tiers'), ('public.recording_offloads'),
    ('public.schools'), ('public.stripe_webhook_events'),
    ('public.video_watermark_jobs')
)
SELECT ok(
  has_schema_privilege('service_role', split_part(tbls.name, '.', 1), 'USAGE')
    AND has_table_privilege('service_role', tbls.name, 'SELECT'),
  tbls.name || ': service_role can read it'
)
FROM tbls
ORDER BY tbls.name;

SELECT ok((SELECT rolbypassrls FROM pg_roles WHERE rolname = 'service_role'),
  'service_role bypasses RLS, so a table with no policy is still readable to it');

SELECT is_empty((SELECT query FROM s0_checks WHERE name = 'rls_no_policy'),
  'every RLS table in public and entitlements has a policy or the explicit-deny comment');

-- ── 3. The pinned functions behave as before ─────────────────────────────────
-- The digest of a fixed event equals SHA-256 of its canonical text, spelled
-- out here, so the hash chain of existing agreements still verifies.
SELECT is(
  public.esign_audit_digest(NULL, '5a000000-0000-4000-8000-000000000003', NULL, 'issued',
                            '2026-01-01 00:00:00+00', NULL, NULL, '{}'::jsonb),
  encode(extensions.digest(
    '|5a000000-0000-4000-8000-000000000003||issued|2026-01-01T00:00:00.000000Z|||{}'::text, 'sha256'), 'hex'),
  'esign_audit_digest: same hash as before for a fixed event'
);
SELECT lives_ok('SELECT * FROM public.esign_audit_heads()',
  'esign_audit_heads runs with its pinned search_path');

-- The trigger functions, attached to temporary tables shaped like their real
-- ones (no real rows are touched; everything rolls back).
CREATE TEMP TABLE s0_audit (id int, note text);
CREATE TRIGGER s0_audit_guard BEFORE UPDATE OR DELETE ON s0_audit
  FOR EACH ROW EXECUTE FUNCTION public.esign_audit_events_guard();
INSERT INTO s0_audit VALUES (1, 'a'), (2, 'b');
SELECT throws_like('UPDATE s0_audit SET note = ''x'' WHERE id = 1',
  '%append-only (UPDATE refused)%', 'esign_audit_events_guard: still refuses an UPDATE');
SELECT set_config('esign.purge', 'on', true);
SELECT lives_ok('DELETE FROM s0_audit WHERE id = 2',
  'esign_audit_events_guard: still lets the retention purge delete');
SELECT set_config('esign.purge', 'off', true);

CREATE TEMP TABLE s0_access_log (id int);
CREATE TRIGGER s0_access_log_append_only BEFORE UPDATE OR DELETE ON s0_access_log
  FOR EACH ROW EXECUTE FUNCTION public.survey_access_log_append_only();
INSERT INTO s0_access_log VALUES (1);
SELECT throws_like('UPDATE s0_access_log SET id = 2',
  '%survey_access_log is append-only%', 'survey_access_log_append_only: still refuses an UPDATE');

CREATE TEMP TABLE s0_distributions (opens_at timestamptz, closes_at timestamptz, updated_at timestamptz);
CREATE TRIGGER s0_distributions_close_date BEFORE INSERT OR UPDATE ON s0_distributions
  FOR EACH ROW EXECUTE FUNCTION public.survey_distributions_close_date();
INSERT INTO s0_distributions (opens_at) VALUES ('2026-01-01 00:00:00+00');
SELECT is((SELECT closes_at FROM s0_distributions), '2026-01-31 00:00:00+00'::timestamptz,
  'survey_distributions_close_date: still closes 30 days after opening');

-- survey_answers_insert_guard reads public.survey_responses by its qualified
-- name; an answer for a response that is not being submitted is refused.
CREATE TEMP TABLE s0_answers (response_id uuid);
CREATE TRIGGER s0_answers_insert_guard BEFORE INSERT ON s0_answers
  FOR EACH ROW EXECUTE FUNCTION public.survey_answers_insert_guard();
SELECT throws_like('INSERT INTO s0_answers VALUES (''5a000000-0000-4000-8000-0000000000aa'')',
  '%is not being submitted%', 'survey_answers_insert_guard: still refuses an answer outside a submission');
DROP TRIGGER s0_answers_insert_guard ON s0_answers;
CREATE TRIGGER s0_answers_immutable BEFORE UPDATE OR DELETE ON s0_answers
  FOR EACH ROW EXECUTE FUNCTION public.survey_answers_immutable();
INSERT INTO s0_answers VALUES ('5a000000-0000-4000-8000-0000000000aa'), ('5a000000-0000-4000-8000-0000000000ab');
SELECT throws_like('UPDATE s0_answers SET response_id = response_id',
  '%survey_answers are immutable%', 'survey_answers_immutable: still refuses an UPDATE');
SELECT lives_ok('DELETE FROM s0_answers WHERE response_id = ''5a000000-0000-4000-8000-0000000000ab''',
  'survey_answers_immutable: still allows the delete that follows its response');

CREATE TEMP TABLE s0_templates (
  key text, version int, approved_at timestamptz, pdf_path text, pdf_sha256 text,
  field_map jsonb, text_html text, disclosure_version text
);
CREATE TRIGGER s0_templates_freeze BEFORE UPDATE ON s0_templates
  FOR EACH ROW EXECUTE FUNCTION public.esign_templates_freeze();
INSERT INTO s0_templates (key, version, approved_at, pdf_path) VALUES
  ('s0-approved', 1, '2026-01-01 00:00:00+00', 'a.pdf'),
  ('s0-draft', 1, NULL, 'b.pdf');
SELECT throws_like('UPDATE s0_templates SET pdf_path = ''c.pdf'' WHERE key = ''s0-approved''',
  '%is approved and cannot be changed%', 'esign_templates_freeze: still freezes an approved version');
SELECT lives_ok('UPDATE s0_templates SET pdf_path = ''c.pdf'' WHERE key = ''s0-draft''',
  'esign_templates_freeze: still lets an unapproved version change');

CREATE TEMP TABLE s0_definitions (
  key text, version int, status text, title text, definition jsonb,
  definition_sha256 text, published_at timestamptz, updated_at timestamptz
);
CREATE TRIGGER s0_definitions_freeze BEFORE UPDATE OR DELETE ON s0_definitions
  FOR EACH ROW EXECUTE FUNCTION public.survey_definitions_freeze();
INSERT INTO s0_definitions (key, version, status, title) VALUES
  ('s0-published', 1, 'published', 'P'),
  ('s0-draft', 1, 'draft', 'D');
SELECT throws_like('UPDATE s0_definitions SET title = ''changed'' WHERE key = ''s0-published''',
  '%is published and cannot be changed%', 'survey_definitions_freeze: still freezes a published definition');
SELECT lives_ok('UPDATE s0_definitions SET title = ''changed'' WHERE key = ''s0-draft''',
  'survey_definitions_freeze: still lets a draft change');

CREATE TEMP TABLE s0_responses (
  id uuid, submitted_at timestamptz, draft_answers jsonb, context jsonb, definition_id uuid,
  invitation_id uuid, respondent_role text, is_minor_at_submit boolean, quote_consent boolean,
  no_quote boolean, followup_consent boolean, event_slug text, event_year int,
  quote_withdrawn_at timestamptz, updated_at timestamptz
);
CREATE TRIGGER s0_responses_freeze BEFORE UPDATE ON s0_responses
  FOR EACH ROW EXECUTE FUNCTION public.survey_responses_freeze();
INSERT INTO s0_responses (id, submitted_at, event_slug) VALUES
  ('5a000000-0000-4000-8000-0000000000ac', '2026-01-01 00:00:00+00', 's0-event');
SELECT throws_like('UPDATE s0_responses SET event_slug = ''other''',
  '%is submitted and cannot be changed%', 'survey_responses_freeze: still freezes a submitted response');

-- ── 4. Self-test: each check can fail ────────────────────────────────────────
-- Probe objects in public (rolled back): an unpinned function, a pinned one,
-- an RLS table with nothing, one with the marker, and one with a policy.
CREATE FUNCTION public.s0_probe_unpinned() RETURNS int LANGUAGE sql AS 'SELECT 1';
CREATE FUNCTION public.s0_probe_pinned() RETURNS int LANGUAGE sql SET search_path = '' AS 'SELECT 1';
CREATE TABLE public.s0_probe_bare (id int);
CREATE TABLE public.s0_probe_marked (id int);
CREATE TABLE public.s0_probe_policy (id int);
ALTER TABLE public.s0_probe_bare ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.s0_probe_marked ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.s0_probe_policy ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.s0_probe_marked IS 'RLS on, no policy: service_role only (S0-3)';
CREATE POLICY s0_probe ON public.s0_probe_policy FOR SELECT TO service_role USING (true);

SELECT set_eq((SELECT query FROM s0_checks WHERE name = 'search_path_mutable'),
  ARRAY['public.s0_probe_unpinned()'],
  'self-test: the search_path check flags an unpinned function, and not a pinned one');
SELECT set_eq((SELECT query FROM s0_checks WHERE name = 'rls_no_policy'),
  ARRAY['public.s0_probe_bare'],
  'self-test: the RLS check flags a table with neither a policy nor the marker, and only that one');

SELECT * FROM finish();
ROLLBACK;
