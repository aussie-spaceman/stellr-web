-- pgTAP: tenant guardian consent (S5 wave 6,
-- supabase/migrations/20261110164339_tenant_guardian_consent.sql). Runs in the CI
-- `db` job against a database built from supabase/baseline.sql + every timestamped
-- migration. Everything rolls back.
--
-- What it pins: the consent table's shape, seal and Stellr refusal; that a
-- participant whose consent is not signed cannot be checked in, by any writer;
-- that a signed consent, or no consent row at all (every Stellr participant),
-- checks in as before; that agreements accept the new envelope type; that the
-- consent row goes with its participant; and that every tenant-event minor gets a
-- pending consent row in the same statement that saves it, whoever writes it, so
-- no participant can be a minor on a tenant event without one; and that a
-- date-of-birth correction to 18 or over removes a still-pending row (not a
-- declined one), so the adult checks in.
BEGIN;
SET LOCAL search_path = extensions, public;

SELECT plan(37);

-- ── Fixtures ─────────────────────────────────────────────────────────────────

CREATE FUNCTION pg_temp.today_syd() RETURNS date LANGUAGE sql AS
  $f$ SELECT (now() AT TIME ZONE 'Australia/Sydney')::date $f$;
-- 30 days away, never 29 Feb (see participant_eligibility.test.sql).
CREATE FUNCTION pg_temp.event_day() RETURNS date LANGUAGE sql AS
  $f$ SELECT CASE WHEN to_char(pg_temp.today_syd() + 30, 'MM-DD') = '02-29'
                  THEN pg_temp.today_syd() + 31
                  ELSE pg_temp.today_syd() + 30 END $f$;

INSERT INTO public.tenants (id, slug, legal_name, display_name, country, payment_region, currency, time_zone, min_participant_age) VALUES
  ('a2000000-0000-4000-8000-000000000001', 'pgtap-tgc', 'TGC Pty Ltd', 'TGC', 'AU', 'AU', 'aud', 'Australia/Sydney', 14);

INSERT INTO public.events (tenant_id, slug, sanity_id, title, activity_type, starts_at, time_zone, country, currency, grade_system, min_participant_age) VALUES
  ('a2000000-0000-4000-8000-000000000001', 'tgc-live', 'pgtap-tgc-live', 'PgTap tgc-live', 'live_event',
   pg_temp.event_day()::timestamp AT TIME ZONE 'Australia/Sydney', 'Australia/Sydney', 'AU', 'aud', 'au_years', NULL),
  ('00000000-0000-4000-8000-000000000001', 'tgc-stellr', 'pgtap-tgc-stellr', 'PgTap tgc-stellr', 'live_event',
   pg_temp.event_day()::timestamp AT TIME ZONE 'Australia/Sydney', 'Australia/Sydney', 'AU', 'aud', 'au_years', NULL);

INSERT INTO public.registrations (id, event_slug, event_title, type, tenant_id) VALUES
  ('b2000000-0000-4000-8000-000000000001', 'tgc-live', 'tgc pending', 'individual', 'a2000000-0000-4000-8000-000000000001'),
  ('b2000000-0000-4000-8000-000000000002', 'tgc-live', 'tgc signed', 'individual', 'a2000000-0000-4000-8000-000000000001'),
  ('b2000000-0000-4000-8000-000000000003', 'tgc-live', 'tgc declined', 'individual', 'a2000000-0000-4000-8000-000000000001'),
  ('b2000000-0000-4000-8000-000000000004', 'tgc-stellr', 'tgc stellr', 'individual', '00000000-0000-4000-8000-000000000001');

-- Each 15 on the event day: inside the tenant floor (14), so the A3 trigger admits them.
INSERT INTO public.participants (id, registration_id, first_name, last_name, email, phone, date_of_birth, gender, t_shirt_size, school_name, age_bracket, event_role) VALUES
  ('c2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'Pg', 'Pending', 'tgc-pending@example.com', '0',
   (pg_temp.event_day() - interval '15 years')::date, '', 'M', '', 'high_school', 'participant'),
  ('c2000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002', 'Pg', 'Signed', 'tgc-signed@example.com', '0',
   (pg_temp.event_day() - interval '15 years')::date, '', 'M', '', 'high_school', 'participant'),
  ('c2000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000003', 'Pg', 'Declined', 'tgc-declined@example.com', '0',
   (pg_temp.event_day() - interval '15 years')::date, '', 'M', '', 'high_school', 'participant'),
  ('c2000000-0000-4000-8000-000000000004', 'b2000000-0000-4000-8000-000000000004', 'Pg', 'Stellr', 'tgc-stellr@example.com', '0',
   (pg_temp.event_day() - interval '15 years')::date, '', 'M', '', 'high_school', 'participant');

-- ── 0. The participant insert opened their consent ────────────────────────────
-- zzz_participants_open_tenant_guardian_consent wrote a pending row for each of the
-- three tenant-event 15-year-olds, and none for Stellr's.

SELECT is((SELECT count(*)::int FROM public.tenant_guardian_consents
            WHERE tenant_id = 'a2000000-0000-4000-8000-000000000001' AND status = 'pending' AND settled_at IS NULL
              AND participant_id IN ('c2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000003')),
  3, 'saving a tenant event''s 15-year-old writes their pending consent row in the same statement');
SELECT is((SELECT count(*)::int FROM public.tenant_guardian_consents WHERE participant_id = 'c2000000-0000-4000-8000-000000000004'),
  0, 'a Stellr event''s 15-year-old gets no consent row: Stellr keeps its own consent forms');
-- The event is 30 days out, so the window is the 14 days.
SELECT ok((SELECT expires_at > now() + interval '13 days' AND expires_at <= now() + interval '14 days'
             FROM public.tenant_guardian_consents WHERE participant_id = 'c2000000-0000-4000-8000-000000000001'),
  'the opened row''s window is 14 days, or the event''s start if sooner');

-- Give the opened rows fixed ids and the answers the tests below need.
UPDATE public.tenant_guardian_consents SET id = 'd2000000-0000-4000-8000-000000000001'
 WHERE participant_id = 'c2000000-0000-4000-8000-000000000001';
UPDATE public.tenant_guardian_consents SET id = 'd2000000-0000-4000-8000-000000000002', status = 'signed', settled_at = now()
 WHERE participant_id = 'c2000000-0000-4000-8000-000000000002';
UPDATE public.tenant_guardian_consents SET id = 'd2000000-0000-4000-8000-000000000003', status = 'declined', settled_at = now()
 WHERE participant_id = 'c2000000-0000-4000-8000-000000000003';

-- An adult on the tenant event, and a registration to move someone to.
INSERT INTO public.registrations (id, event_slug, event_title, type, tenant_id) VALUES
  ('b2000000-0000-4000-8000-000000000005', 'tgc-live', 'tgc adult', 'individual', 'a2000000-0000-4000-8000-000000000001'),
  ('b2000000-0000-4000-8000-000000000006', 'tgc-live', 'tgc moved', 'individual', 'a2000000-0000-4000-8000-000000000001'),
  ('b2000000-0000-4000-8000-000000000007', 'tgc-live', 'tgc walk-in', 'individual', 'a2000000-0000-4000-8000-000000000001');
INSERT INTO public.participants (id, registration_id, first_name, last_name, email, phone, date_of_birth, gender, t_shirt_size, school_name, age_bracket, event_role) VALUES
  ('c2000000-0000-4000-8000-000000000005', 'b2000000-0000-4000-8000-000000000005', 'Pg', 'Adult', 'tgc-adult@example.com', '0',
   (pg_temp.event_day() - interval '20 years')::date, '', 'M', '', 'high_school', 'participant');

SELECT is((SELECT count(*)::int FROM public.tenant_guardian_consents WHERE participant_id = 'c2000000-0000-4000-8000-000000000005'),
  0, 'an adult on a tenant event gets no consent row');

-- ── 1. The table and its seal ─────────────────────────────────────────────────

SELECT has_table('public', 'tenant_guardian_consents', 'tenant_guardian_consents exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tenant_guardian_consents'::regclass), 'tenant_guardian_consents has RLS enabled');
SELECT ok(NOT has_table_privilege('anon', 'public.tenant_guardian_consents', 'SELECT, INSERT, UPDATE, DELETE'), 'anon has no privilege on tenant_guardian_consents');
SELECT ok(NOT has_table_privilege('authenticated', 'public.tenant_guardian_consents', 'SELECT, INSERT, UPDATE, DELETE'), 'authenticated has no privilege on tenant_guardian_consents');
SELECT ok(has_table_privilege('service_role', 'public.tenant_guardian_consents', 'SELECT, INSERT, UPDATE, DELETE'), 'service_role may read and write tenant_guardian_consents');
SELECT ok(NOT EXISTS (SELECT 1 FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'tenant_guardian_consents' AND column_name ~ '(email|name|phone)'),
  'tenant_guardian_consents holds no contact column');
SELECT ok(NOT has_function_privilege('anon', 'public.participants_refuse_unconsented_check_in()', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.participants_refuse_unconsented_check_in()', 'EXECUTE'),
  'the check-in guard is not executable by anon or authenticated');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_trigger tg
   WHERE tg.tgrelid = 'public.participants'::regclass AND tg.tgname = 'zzz_participants_refuse_unconsented_check_in'
     AND tg.tgfoid = 'public.participants_refuse_unconsented_check_in()'::regprocedure AND tg.tgenabled = 'O'
), 'participants: zzz_participants_refuse_unconsented_check_in is enabled');
SELECT ok(NOT has_table_privilege('service_role', 'public.tenant_guardian_consents', 'TRUNCATE'),
  'service_role has only the grant the migration names: no TRUNCATE');
SELECT ok(NOT has_function_privilege('anon', 'public.participants_open_tenant_guardian_consent()', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.participants_open_tenant_guardian_consent()', 'EXECUTE'),
  'the consent opener is not executable by anon or authenticated');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_trigger tg
   WHERE tg.tgrelid = 'public.participants'::regclass AND tg.tgname = 'zzz_participants_open_tenant_guardian_consent'
     AND tg.tgfoid = 'public.participants_open_tenant_guardian_consent()'::regprocedure AND tg.tgenabled = 'O'
), 'participants: zzz_participants_open_tenant_guardian_consent is enabled');

-- ── 2. What the table refuses ─────────────────────────────────────────────────

SELECT throws_ok(
  $$INSERT INTO public.tenant_guardian_consents (tenant_id, registration_id, participant_id, expires_at)
    VALUES ('00000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-000000000004', now())$$,
  '23514', NULL, 'a consent row for Stellr is refused: Stellr keeps its own consent forms');
SELECT throws_ok(
  $$UPDATE public.tenant_guardian_consents SET status = 'signed' WHERE id = 'd2000000-0000-4000-8000-000000000001'$$,
  '23514', NULL, 'a settled status with no settled_at is refused');
SELECT throws_ok(
  $$UPDATE public.tenant_guardian_consents SET status = 'approved', settled_at = now() WHERE id = 'd2000000-0000-4000-8000-000000000001'$$,
  '23514', NULL, 'an unknown status is refused');
SELECT throws_ok(
  $$INSERT INTO public.tenant_guardian_consents (tenant_id, registration_id, participant_id, expires_at)
    VALUES ('a2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', now())$$,
  '23505', NULL, 'one consent row per participant');

-- ── 3. No check-in before consent ─────────────────────────────────────────────

SELECT throws_ok(
  $$UPDATE public.participants SET checked_in_at = now(), check_in_method = 'qr' WHERE id = 'c2000000-0000-4000-8000-000000000001'$$,
  '23514', 'guardian_consent_pending', 'a consent-pending participant cannot be checked in (QR)');
SELECT throws_ok(
  $$UPDATE public.participants SET checked_in_at = now(), check_in_method = 'manual' WHERE id = 'c2000000-0000-4000-8000-000000000001'$$,
  '23514', 'guardian_consent_pending', 'a consent-pending participant cannot be checked in (desk)');
SELECT throws_ok(
  $$UPDATE public.participants SET checked_in_at = now() WHERE id = 'c2000000-0000-4000-8000-000000000003'$$,
  '23514', 'guardian_consent_pending', 'a participant whose guardian declined cannot be checked in');
SELECT lives_ok(
  $$UPDATE public.participants SET checked_in_at = now(), check_in_method = 'qr' WHERE id = 'c2000000-0000-4000-8000-000000000002'$$,
  'a participant whose guardian signed checks in');
SELECT lives_ok(
  $$UPDATE public.participants SET checked_in_at = now(), check_in_method = 'qr' WHERE id = 'c2000000-0000-4000-8000-000000000004'$$,
  'a Stellr participant, with no consent row, checks in as before');
SELECT lives_ok(
  $$UPDATE public.participants SET checked_in_at = NULL, check_in_method = NULL WHERE id = 'c2000000-0000-4000-8000-000000000004'$$,
  'undoing a check-in is never refused');
SELECT lives_ok(
  $$UPDATE public.participants SET first_name = 'Pg2' WHERE id = 'c2000000-0000-4000-8000-000000000001'$$,
  'other updates to a consent-pending participant are not refused');

-- Once signed, the same participant checks in.
UPDATE public.tenant_guardian_consents SET status = 'signed', settled_at = now() WHERE id = 'd2000000-0000-4000-8000-000000000001';
SELECT lives_ok(
  $$UPDATE public.participants SET checked_in_at = now(), check_in_method = 'qr' WHERE id = 'c2000000-0000-4000-8000-000000000001'$$,
  'after the guardian signs, the participant checks in');

-- A writer that saves a tenant-event minor already checked in is refused too.
SELECT throws_ok(
  $$INSERT INTO public.participants (id, registration_id, first_name, last_name, email, phone, date_of_birth, gender, t_shirt_size, school_name, age_bracket, event_role, checked_in_at, check_in_method)
    VALUES ('c2000000-0000-4000-8000-000000000007', 'b2000000-0000-4000-8000-000000000007', 'Pg', 'WalkIn', 'tgc-walkin@example.com', '0',
            (pg_temp.event_day() - interval '16 years')::date, '', 'M', '', 'high_school', 'participant', now(), 'manual')$$,
  '23514', 'guardian_consent_pending', 'a tenant-event minor cannot be inserted already checked in');

-- A date-of-birth correction that makes someone a minor opens their consent.
UPDATE public.participants SET date_of_birth = (pg_temp.event_day() - interval '16 years')::date
 WHERE id = 'c2000000-0000-4000-8000-000000000005';
SELECT is((SELECT status FROM public.tenant_guardian_consents WHERE participant_id = 'c2000000-0000-4000-8000-000000000005'),
  'pending', 'a date-of-birth correction that makes a tenant participant a minor opens a pending consent');

-- And a correction back to 18 or over removes that still-pending row, so the adult
-- checks in, is mailed and is never swept.
UPDATE public.participants SET date_of_birth = (pg_temp.event_day() - interval '20 years')::date
 WHERE id = 'c2000000-0000-4000-8000-000000000005';
SELECT is((SELECT count(*)::int FROM public.tenant_guardian_consents WHERE participant_id = 'c2000000-0000-4000-8000-000000000005'),
  0, 'a date-of-birth correction to 18 or over removes a consent row still pending');
SELECT lives_ok(
  $$UPDATE public.participants SET checked_in_at = now(), check_in_method = 'manual' WHERE id = 'c2000000-0000-4000-8000-000000000005'$$,
  'after the correction to 18 or over, the participant checks in');

-- A declined consent is not undone by a correction: its removal goes on.
UPDATE public.participants SET date_of_birth = (pg_temp.event_day() - interval '20 years')::date
 WHERE id = 'c2000000-0000-4000-8000-000000000003';
SELECT is((SELECT status FROM public.tenant_guardian_consents WHERE participant_id = 'c2000000-0000-4000-8000-000000000003'),
  'declined', 'a correction to 18 or over leaves a declined consent as it is');

-- A move to another registration starts a new consent: a signature is for one registration.
UPDATE public.participants SET registration_id = 'b2000000-0000-4000-8000-000000000006'
 WHERE id = 'c2000000-0000-4000-8000-000000000002';
SELECT ok((SELECT status = 'pending' AND settled_at IS NULL AND registration_id = 'b2000000-0000-4000-8000-000000000006'
             FROM public.tenant_guardian_consents WHERE participant_id = 'c2000000-0000-4000-8000-000000000002'),
  'moving a signed minor to another registration resets their consent to pending');

-- ── 4. The consent envelope's type ────────────────────────────────────────────

SELECT lives_ok(
  $$INSERT INTO public.agreements (participant_id, event_slug, event_title, envelope_id, envelope_type, signer_name, signer_email, minor_name, tenant_id)
    VALUES ('c2000000-0000-4000-8000-000000000003', 'tgc-live', 'PgTap tgc-live', 'native-pgtap-tgc', 'tenant_guardian_consent',
            'Pg Guardian', 'tgc-guardian@example.com', 'Pg Declined', 'a2000000-0000-4000-8000-000000000001')$$,
  'agreements accept a tenant_guardian_consent envelope');
SELECT throws_ok(
  $$INSERT INTO public.agreements (event_slug, event_title, envelope_id, envelope_type, signer_name, signer_email, minor_name)
    VALUES ('tgc-live', 'PgTap tgc-live', 'native-pgtap-bogus', 'bogus', 'X', 'x@example.com', 'Y')$$,
  '23514', NULL, 'agreements still refuse an unknown envelope type');
SELECT ok((SELECT convalidated FROM pg_constraint
   WHERE conrelid = 'public.agreements'::regclass AND conname = 'docusign_envelopes_envelope_type_check'),
  'the widened envelope type CHECK is validated');

-- ── 5. The consent row goes with its registration ─────────────────────────────

DELETE FROM public.registrations WHERE id = 'b2000000-0000-4000-8000-000000000003';
SELECT is((SELECT count(*)::int FROM public.tenant_guardian_consents WHERE id = 'd2000000-0000-4000-8000-000000000003'), 0,
  'removing the registration removes its participant and consent row');

SELECT * FROM finish();
ROLLBACK;
