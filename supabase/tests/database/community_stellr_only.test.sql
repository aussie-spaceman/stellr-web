-- pgTAP: community tables hold Stellr's rows only (S5 B9, docs/TENANCY-S5.md). Runs in
-- the CI `db` job against a database built from supabase/baseline.sql + every
-- timestamped migration. Everything rolls back.
--
-- For each of the four tables: Stellr's rows still write, every way a row could come
-- to name another tenant is refused with 23514, in log and enforce mode, and a row
-- that was refused leaves nothing behind.
BEGIN;
SET LOCAL search_path = extensions, public;

SELECT plan(45);

-- ── The constraints ──────────────────────────────────────────────────────────

CREATE FUNCTION pg_temp.validated(p_table regclass, p_name text) RETURNS boolean LANGUAGE sql AS
  $f$ SELECT convalidated FROM pg_constraint WHERE conrelid = p_table AND conname = p_name AND contype = 'c' $f$;
CREATE FUNCTION pg_temp.definition(p_table regclass, p_name text) RETURNS text LANGUAGE sql AS
  $f$ SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = p_table AND conname = p_name $f$;

SELECT ok(pg_temp.validated('public.community_spaces', 'community_spaces_stellr_only'), 'community_spaces: the check exists and is validated');
SELECT ok(pg_temp.validated('public.community_resources', 'community_resources_stellr_only'), 'community_resources: the check exists and is validated');
SELECT ok(pg_temp.validated('public.mentoring_cohorts', 'mentoring_cohorts_stellr_only'), 'mentoring_cohorts: the check exists and is validated');
SELECT ok(pg_temp.validated('public.training_modules', 'training_modules_stellr_only'), 'training_modules: the check exists and is validated');
SELECT is(
  (SELECT count(DISTINCT d)::int FROM (VALUES
    (pg_temp.definition('public.community_spaces', 'community_spaces_stellr_only')),
    (pg_temp.definition('public.community_resources', 'community_resources_stellr_only')),
    (pg_temp.definition('public.mentoring_cohorts', 'mentoring_cohorts_stellr_only')),
    (pg_temp.definition('public.training_modules', 'training_modules_stellr_only'))) AS v(d)),
  1, 'all four checks say the same thing'
);
SELECT matches(pg_temp.definition('public.community_spaces', 'community_spaces_stellr_only'), '00000000-0000-4000-8000-000000000001', 'the check names the Stellr tenant');

-- ── Fixtures: a Stellr event and an event of another tenant ──────────────────

INSERT INTO public.tenants (id, slug, legal_name, display_name, country, payment_region, currency, time_zone)
  VALUES ('11111111-1111-4111-8111-111111111111', 'b9-canary', 'B9 Canary Pty Ltd', 'B9 Canary', 'AU', 'AU', 'aud', 'Australia/Sydney');
INSERT INTO public.events (tenant_id, slug, sanity_id, title, time_zone, country, currency, grade_system) VALUES
  ('00000000-0000-4000-8000-000000000001', 'b9-stellr-event', 'b9-stellr-sanity', 'B9 Stellr', 'UTC', 'US', 'usd', 'us_grades'),
  -- A second Stellr event: community_spaces.sanity_event_id is unique, so enforce mode needs its own.
  ('00000000-0000-4000-8000-000000000001', 'b9-stellr-event-2', 'b9-stellr-sanity-2', 'B9 Stellr 2', 'UTC', 'US', 'usd', 'us_grades'),
  ('11111111-1111-4111-8111-111111111111', 'b9-canary-event', 'b9-canary-sanity', 'B9 Canary', 'UTC', 'AU', 'aud', 'au_years');

-- The canary tenant's id, supplied directly.
CREATE FUNCTION pg_temp.canary() RETURNS uuid LANGUAGE sql AS $f$ SELECT '11111111-1111-4111-8111-111111111111'::uuid $f$;
CREATE FUNCTION pg_temp.stellr() RETURNS uuid LANGUAGE sql AS $f$ SELECT '00000000-0000-4000-8000-000000000001'::uuid $f$;

-- ── Log mode: the live setting ───────────────────────────────────────────────
UPDATE public.tenancy_settings SET derivation_mode = 'log';

-- Stellr's rows go in: named event, no event, and an event the mirror does not know.
SELECT lives_ok($q$INSERT INTO public.community_spaces (slug, name, sanity_event_id) VALUES ('b9-s1', 'B9', 'b9-stellr-sanity')$q$, 'community_spaces: a row for a Stellr event writes');
SELECT lives_ok($q$INSERT INTO public.community_spaces (slug, name) VALUES ('b9-s2', 'B9')$q$, 'community_spaces: a row with no event writes');
SELECT lives_ok($q$INSERT INTO public.community_spaces (slug, name, sanity_event_id) VALUES ('b9-s3', 'B9', 'b9-not-mirrored')$q$, 'community_spaces: a row for an unmirrored event writes');
SELECT is((SELECT count(*)::int FROM public.community_spaces WHERE slug IN ('b9-s1', 'b9-s2', 'b9-s3') AND tenant_id = pg_temp.stellr()), 3, 'community_spaces: all three are stamped Stellr');

SELECT lives_ok($q$INSERT INTO public.community_resources (title, event_ref) VALUES ('b9-r1', 'b9-stellr-sanity')$q$, 'community_resources: a row for a Stellr event writes');
SELECT lives_ok($q$INSERT INTO public.community_resources (title) VALUES ('b9-r2')$q$, 'community_resources: a row with no event writes');
SELECT lives_ok($q$INSERT INTO public.community_resources (title, event_ref) VALUES ('b9-r3', 'b9-not-mirrored')$q$, 'community_resources: a row for an unmirrored event writes');
SELECT is((SELECT count(*)::int FROM public.community_resources WHERE title IN ('b9-r1', 'b9-r2', 'b9-r3') AND tenant_id = pg_temp.stellr()), 3, 'community_resources: all three are stamped Stellr');

SELECT lives_ok($q$INSERT INTO public.mentoring_cohorts (name, sanity_event_id) VALUES ('b9-c1', 'b9-stellr-sanity')$q$, 'mentoring_cohorts: a row for a Stellr event writes');
SELECT lives_ok($q$INSERT INTO public.mentoring_cohorts (name) VALUES ('b9-c2')$q$, 'mentoring_cohorts: a row with no event writes');
SELECT lives_ok($q$INSERT INTO public.mentoring_cohorts (name, sanity_event_id) VALUES ('b9-c3', 'b9-not-mirrored')$q$, 'mentoring_cohorts: a row for an unmirrored event writes');
SELECT is((SELECT count(*)::int FROM public.mentoring_cohorts WHERE name IN ('b9-c1', 'b9-c2', 'b9-c3') AND tenant_id = pg_temp.stellr()), 3, 'mentoring_cohorts: all three are stamped Stellr');

SELECT lives_ok($q$INSERT INTO public.training_modules (title, event_ref) VALUES ('b9-m1', 'b9-stellr-sanity')$q$, 'training_modules: a row for a Stellr event writes');
SELECT lives_ok($q$INSERT INTO public.training_modules (title) VALUES ('b9-m2')$q$, 'training_modules: a row with no event writes');
SELECT lives_ok($q$INSERT INTO public.training_modules (title, event_ref) VALUES ('b9-m3', 'b9-not-mirrored')$q$, 'training_modules: a row for an unmirrored event writes');
SELECT is((SELECT count(*)::int FROM public.training_modules WHERE title IN ('b9-m1', 'b9-m2', 'b9-m3') AND tenant_id = pg_temp.stellr()), 3, 'training_modules: all three are stamped Stellr');

-- A row naming the other tenant's event is derived to that tenant, then refused.
SELECT throws_ok($q$INSERT INTO public.community_spaces (slug, name, sanity_event_id) VALUES ('b9-x', 'B9', 'b9-canary-sanity')$q$, '23514', NULL, 'community_spaces: a row for another tenant''s event is refused');
SELECT throws_ok($q$INSERT INTO public.community_resources (title, event_ref) VALUES ('b9-x', 'b9-canary-sanity')$q$, '23514', NULL, 'community_resources: a row for another tenant''s event is refused');
SELECT throws_ok($q$INSERT INTO public.mentoring_cohorts (name, sanity_event_id) VALUES ('b9-x', 'b9-canary-sanity')$q$, '23514', NULL, 'mentoring_cohorts: a row for another tenant''s event is refused');
SELECT throws_ok($q$INSERT INTO public.training_modules (title, event_ref) VALUES ('b9-x', 'b9-canary-sanity')$q$, '23514', NULL, 'training_modules: a row for another tenant''s event is refused');

-- A supplied tenant with no event: the derivation keeps it, so only the check stops it.
SELECT throws_ok($q$INSERT INTO public.community_spaces (slug, name, tenant_id) VALUES ('b9-x', 'B9', pg_temp.canary())$q$, '23514', NULL, 'community_spaces: another tenant''s id with no event is refused');
SELECT throws_ok($q$INSERT INTO public.community_resources (title, tenant_id) VALUES ('b9-x', pg_temp.canary())$q$, '23514', NULL, 'community_resources: another tenant''s id with no event is refused');
SELECT throws_ok($q$INSERT INTO public.mentoring_cohorts (name, tenant_id) VALUES ('b9-x', pg_temp.canary())$q$, '23514', NULL, 'mentoring_cohorts: another tenant''s id with no event is refused');
SELECT throws_ok($q$INSERT INTO public.training_modules (title, tenant_id) VALUES ('b9-x', pg_temp.canary())$q$, '23514', NULL, 'training_modules: another tenant''s id with no event is refused');

-- A Stellr row cannot be moved across, by its event or by its tenant.
SELECT throws_ok($q$UPDATE public.community_spaces SET sanity_event_id = 'b9-canary-sanity' WHERE slug = 'b9-s2'$q$, '23514', NULL, 'community_spaces: pointing a row at another tenant''s event is refused');
SELECT throws_ok($q$UPDATE public.community_resources SET event_ref = 'b9-canary-sanity' WHERE title = 'b9-r2'$q$, '23514', NULL, 'community_resources: pointing a row at another tenant''s event is refused');
SELECT throws_ok($q$UPDATE public.mentoring_cohorts SET sanity_event_id = 'b9-canary-sanity' WHERE name = 'b9-c2'$q$, '23514', NULL, 'mentoring_cohorts: pointing a row at another tenant''s event is refused');
SELECT throws_ok($q$UPDATE public.training_modules SET event_ref = 'b9-canary-sanity' WHERE title = 'b9-m2'$q$, '23514', NULL, 'training_modules: pointing a row at another tenant''s event is refused');
SELECT throws_ok($q$UPDATE public.community_spaces SET tenant_id = pg_temp.canary() WHERE slug = 'b9-s2'$q$, '23514', NULL, 'community_spaces: moving a row to another tenant is refused');

-- A refused write left nothing behind, and an ordinary edit still works.
SELECT is((SELECT count(*)::int FROM public.community_spaces WHERE slug = 'b9-x'), 0, 'community_spaces: a refused row was not written');
SELECT lives_ok($q$UPDATE public.community_spaces SET name = 'Renamed' WHERE slug = 'b9-s1'$q$, 'community_spaces: a Stellr row can still be edited');

-- ── Enforce mode: the cut-over must not change this ──────────────────────────
UPDATE public.tenancy_settings SET derivation_mode = 'enforce';

SELECT lives_ok($q$INSERT INTO public.community_spaces (slug, name, sanity_event_id) VALUES ('b9-s4', 'B9', 'b9-stellr-sanity-2')$q$, 'enforce: a row for a Stellr event writes');
SELECT throws_ok($q$INSERT INTO public.community_spaces (slug, name, sanity_event_id) VALUES ('b9-y', 'B9', 'b9-canary-sanity')$q$, '23514', NULL, 'enforce: community_spaces refuses another tenant''s event');
SELECT throws_ok($q$INSERT INTO public.community_resources (title, event_ref) VALUES ('b9-y', 'b9-canary-sanity')$q$, '23514', NULL, 'enforce: community_resources refuses another tenant''s event');
SELECT throws_ok($q$INSERT INTO public.mentoring_cohorts (name, sanity_event_id) VALUES ('b9-y', 'b9-canary-sanity')$q$, '23514', NULL, 'enforce: mentoring_cohorts refuses another tenant''s event');
SELECT throws_ok($q$INSERT INTO public.training_modules (title, event_ref) VALUES ('b9-y', 'b9-canary-sanity')$q$, '23514', NULL, 'enforce: training_modules refuses another tenant''s event');
SELECT throws_ok($q$INSERT INTO public.training_modules (title, tenant_id) VALUES ('b9-y', pg_temp.canary())$q$, '23514', NULL, 'enforce: another tenant''s id with no event is refused');

UPDATE public.tenancy_settings SET derivation_mode = 'log';

-- ── NULL stays allowed: rows the backfill has not reached ────────────────────
ALTER TABLE public.training_modules DISABLE TRIGGER zz_tenancy_derive_tenant_id;
SELECT lives_ok($q$INSERT INTO public.training_modules (title) VALUES ('b9-null')$q$, 'a row with a NULL tenant_id still writes');
ALTER TABLE public.training_modules ENABLE TRIGGER zz_tenancy_derive_tenant_id;
SELECT is((SELECT tenant_id FROM public.training_modules WHERE title = 'b9-null'), NULL::uuid, 'and it stays NULL');

SELECT * FROM finish();
ROLLBACK;
