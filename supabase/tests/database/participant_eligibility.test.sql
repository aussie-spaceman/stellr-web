-- pgTAP: the participants eligibility backstop (S5 A3, docs/TENANCY-S5.md). Runs in
-- the CI `db` job against a database built from supabase/baseline.sql + every
-- timestamped migration. Everything rolls back.
--
-- Dates are worked out from now(), which is fixed for the whole transaction, so a
-- run that crosses midnight still agrees with itself. A refusal is asserted by its
-- exact message, which also proves the text holds no date of birth.
BEGIN;
SET LOCAL search_path = extensions, public;

SELECT plan(82);

-- ── Fixtures ─────────────────────────────────────────────────────────────────

CREATE FUNCTION pg_temp.today_syd() RETURNS date LANGUAGE sql AS
  $f$ SELECT (now() AT TIME ZONE 'Australia/Sydney')::date $f$;
-- The start date of most fixture events: 30 days away, so 14 on the day is 13 today.
-- Never 29 Feb: fourteen years back it has no same date, so "turns 14 that day" fails.
CREATE FUNCTION pg_temp.event_day() RETURNS date LANGUAGE sql AS
  $f$ SELECT CASE WHEN to_char(pg_temp.today_syd() + 30, 'MM-DD') = '02-29'
                  THEN pg_temp.today_syd() + 31
                  ELSE pg_temp.today_syd() + 30 END $f$;
CREATE FUNCTION pg_temp.midnight_syd(date) RETURNS timestamptz LANGUAGE sql AS
  $f$ SELECT $1::timestamp AT TIME ZONE 'Australia/Sydney' $f$;
CREATE FUNCTION pg_temp.years_before(date, int) RETURNS date LANGUAGE sql AS
  $f$ SELECT ($1 - make_interval(years => $2))::date $f$;

CREATE FUNCTION pg_temp.add_event(p_slug text, p_tenant uuid, p_zone text, p_starts timestamptz, p_activity text, p_min int)
RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.events (tenant_id, slug, sanity_id, title, activity_type, starts_at, time_zone, country, currency, grade_system, min_participant_age)
  VALUES (p_tenant, p_slug, 'pgtap-' || p_slug, 'PgTap ' || p_slug, p_activity, p_starts, p_zone, 'AU', 'aud', 'au_years', p_min);
$f$;

-- event_title doubles as the fixture's name for its registration.
CREATE FUNCTION pg_temp.add_registration(p_key text, p_slug text, p_tenant uuid)
RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.registrations (event_slug, event_title, type, tenant_id)
  VALUES (p_slug, p_key, 'individual', p_tenant);
$f$;

CREATE FUNCTION pg_temp.add_participant(p_key text, p_dob date, p_email text)
RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.participants (registration_id, first_name, last_name, email, phone, date_of_birth, gender, t_shirt_size, school_name, age_bracket, event_role)
  VALUES ((SELECT r.id FROM public.registrations r WHERE r.event_title = p_key), 'Pg', 'Tap', p_email, '0', p_dob, '', 'M', '', 'high_school', 'participant');
$f$;

INSERT INTO public.tenants (id, slug, legal_name, display_name, country, payment_region, currency, time_zone, min_participant_age) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'pgtap-elig-a', 'Elig A Pty Ltd', 'Elig A', 'AU', 'AU', 'aud', 'Australia/Sydney', 14),
  ('a1000000-0000-4000-8000-000000000002', 'pgtap-elig-b', 'Elig B Pty Ltd', 'Elig B', 'AU', 'AU', 'aud', 'Australia/Sydney', 16);

SELECT pg_temp.add_event('elig-live', 'a1000000-0000-4000-8000-000000000001', 'Australia/Sydney', pg_temp.midnight_syd(pg_temp.event_day()), 'live_event', NULL);
SELECT pg_temp.add_event('elig-far', 'a1000000-0000-4000-8000-000000000001', 'Australia/Sydney', pg_temp.midnight_syd((pg_temp.today_syd() + interval '2 years')::date), 'live_event', NULL);
SELECT pg_temp.add_event('elig-min16', 'a1000000-0000-4000-8000-000000000001', 'Australia/Sydney', pg_temp.midnight_syd(pg_temp.event_day()), 'live_event', 16);
SELECT pg_temp.add_event('elig-min10', 'a1000000-0000-4000-8000-000000000001', 'Australia/Sydney', pg_temp.midnight_syd(pg_temp.event_day()), 'live_event', 10);
SELECT pg_temp.add_event('elig-tenant16', 'a1000000-0000-4000-8000-000000000002', 'Australia/Sydney', pg_temp.midnight_syd(pg_temp.event_day()), 'live_event', NULL);
SELECT pg_temp.add_event('elig-campaign', 'a1000000-0000-4000-8000-000000000001', 'Australia/Sydney', NULL, 'campaign', NULL);
SELECT pg_temp.add_event('elig-undated', 'a1000000-0000-4000-8000-000000000001', 'Australia/Sydney', NULL, 'live_event', NULL);
SELECT pg_temp.add_event('elig-badzone', 'a1000000-0000-4000-8000-000000000001', 'Mars/Olympus_Mons', pg_temp.midnight_syd(pg_temp.event_day()), 'live_event', NULL);
SELECT pg_temp.add_event('elig-target', 'a1000000-0000-4000-8000-000000000001', 'Australia/Sydney', pg_temp.midnight_syd(pg_temp.event_day()), 'live_event', NULL);
SELECT pg_temp.add_event('elig-recheck', 'a1000000-0000-4000-8000-000000000001', 'Australia/Sydney', pg_temp.midnight_syd(pg_temp.event_day()), 'live_event', NULL);
SELECT pg_temp.add_event('elig-recheck-empty', 'a1000000-0000-4000-8000-000000000001', 'Australia/Sydney', pg_temp.midnight_syd(pg_temp.event_day()), 'live_event', NULL);
SELECT pg_temp.add_event('elig-stellr', '00000000-0000-4000-8000-000000000001', 'Australia/Sydney', pg_temp.midnight_syd(pg_temp.event_day()), 'live_event', NULL);
SELECT pg_temp.add_event('elig-stellr-moves', '00000000-0000-4000-8000-000000000001', 'Australia/Sydney', pg_temp.midnight_syd(pg_temp.event_day()), 'live_event', NULL);
SELECT pg_temp.add_event('elig-nochange', 'a1000000-0000-4000-8000-000000000001', 'Australia/Sydney', pg_temp.midnight_syd(pg_temp.event_day()), 'live_event', NULL);
SELECT pg_temp.add_event('elig-zone', 'a1000000-0000-4000-8000-000000000001', 'Australia/Sydney', pg_temp.midnight_syd(pg_temp.event_day()), 'live_event', NULL);
SELECT pg_temp.add_event('elig-slug-from', 'a1000000-0000-4000-8000-000000000001', 'Australia/Sydney', pg_temp.midnight_syd(pg_temp.event_day()), 'live_event', NULL);
SELECT pg_temp.add_event('elig-ahead', 'a1000000-0000-4000-8000-000000000001', 'Pacific/Kiritimati', NULL, 'campaign', NULL);
SELECT pg_temp.add_event('elig-behind', 'a1000000-0000-4000-8000-000000000001', 'Pacific/Pago_Pago', NULL, 'campaign', NULL);

SELECT pg_temp.add_registration('live', 'elig-live', NULL);
SELECT pg_temp.add_registration('far', 'elig-far', NULL);
SELECT pg_temp.add_registration('min16', 'elig-min16', NULL);
SELECT pg_temp.add_registration('min10', 'elig-min10', NULL);
SELECT pg_temp.add_registration('tenant16', 'elig-tenant16', NULL);
SELECT pg_temp.add_registration('campaign', 'elig-campaign', NULL);
SELECT pg_temp.add_registration('undated', 'elig-undated', NULL);
SELECT pg_temp.add_registration('badzone', 'elig-badzone', NULL);
SELECT pg_temp.add_registration('stellr', 'elig-stellr', NULL);
SELECT pg_temp.add_registration('ahead', 'elig-ahead', NULL);
SELECT pg_temp.add_registration('behind', 'elig-behind', NULL);

-- ── 1. The objects, their order and their seal ───────────────────────────────

SELECT ok(EXISTS (
  SELECT 1 FROM pg_trigger tg
   WHERE tg.tgrelid = 'public.participants'::regclass AND tg.tgname = 'zzz_participants_assert_eligible'
     AND tg.tgfoid = 'public.participants_assert_eligible()'::regprocedure AND tg.tgenabled = 'O'
), 'participants: zzz_participants_assert_eligible is enabled');
SELECT is(
  (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
     FROM pg_trigger tg JOIN pg_attribute a ON a.attrelid = tg.tgrelid AND a.attnum = ANY (tg.tgattr)
    WHERE tg.tgrelid = 'public.participants'::regclass AND tg.tgname = 'zzz_participants_assert_eligible'),
  ARRAY['date_of_birth', 'registration_id']::text[],
  'participants: an update re-checks only when it writes date_of_birth or registration_id'
);
SELECT ok(
  'zzz_participants_assert_eligible' COLLATE "C" > 'zz_tenancy_derive_tenant_id' COLLATE "C",
  'participants: the trigger sorts after any derivation trigger'
);
SELECT ok(EXISTS (
  SELECT 1 FROM pg_trigger tg
   WHERE tg.tgrelid = 'public.registrations'::regclass AND tg.tgname = 'zzz_registrations_assert_eligible'
     AND tg.tgfoid = 'public.registrations_assert_eligible()'::regprocedure AND tg.tgenabled = 'O'
), 'registrations: the re-check trigger is enabled');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_trigger tg
   WHERE tg.tgrelid = 'public.events'::regclass AND tg.tgname = 'zz_events_assert_participants_eligible'
     AND tg.tgfoid = 'public.events_assert_participants_eligible()'::regprocedure AND tg.tgenabled = 'O'
), 'events: the re-check trigger is enabled');
SELECT is(
  (SELECT count(*)::int
     FROM unnest(ARRAY[
       'public.participant_eligibility_refusal(date, text, uuid)',
       'public.participants_assert_eligible()',
       'public.registrations_assert_eligible()',
       'public.events_assert_participants_eligible()'
     ]) AS f(fn)
     CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS g(rolname)
    WHERE has_function_privilege(g.rolname::name, f.fn, 'EXECUTE')),
  0, 'anon and authenticated can execute none of the four functions'
);
SELECT is(
  (SELECT count(*)::int FROM pg_proc p
    WHERE p.oid IN ('public.participants_assert_eligible()'::regprocedure,
                    'public.registrations_assert_eligible()'::regprocedure,
                    'public.events_assert_participants_eligible()'::regprocedure)
      AND p.prosecdef AND array_to_string(p.proconfig, ',') LIKE 'search_path=%'),
  3, 'the trigger functions are SECURITY DEFINER with a pinned search_path'
);
-- test/registration/participants-eligibility-sql.test.ts holds these three numbers
-- equal to TENANT_MIN_PARTICIPANT_AGE, TENANT_MIN_AGE_TODAY and MAX_AGE.
SELECT ok((SELECT prosrc LIKE '%platform_min_age constant int := 14;%' FROM pg_proc WHERE oid = 'public.participant_eligibility_refusal(date, text, uuid)'::regprocedure), 'the floor literal is the one the TypeScript constant says');
SELECT ok((SELECT prosrc LIKE '%min_age_today constant int := 13;%' FROM pg_proc WHERE oid = 'public.participant_eligibility_refusal(date, text, uuid)'::regprocedure), 'the under-13-today literal is the one the TypeScript constant says');
SELECT ok((SELECT prosrc LIKE '%max_age constant int := 120;%' FROM pg_proc WHERE oid = 'public.participant_eligibility_refusal(date, text, uuid)'::regprocedure), 'the oldest-age literal is the one the TypeScript constant says');

-- ── 2. A tenant event with an events row ─────────────────────────────────────

SELECT throws_ok(
  $q$SELECT pg_temp.add_participant('live', pg_temp.years_before(pg_temp.event_day(), 14) + 1, 'live13@example.com')$q$,
  '23514', 'participant eligibility: under_minimum_age', 'a day short of 14 on the local start date is refused'
);
SELECT lives_ok(
  $q$SELECT pg_temp.add_participant('live', pg_temp.years_before(pg_temp.event_day(), 14), 'live14@example.com')$q$,
  '14 on the local start date is accepted, though the same instant in UTC is the day before'
);
SELECT throws_ok(
  $q$SELECT pg_temp.add_participant('live', NULL, 'livenull@example.com')$q$,
  '23514', 'participant eligibility: dob_missing', 'a NULL date of birth is refused by the eligibility check, ahead of NOT NULL'
);
SELECT throws_ok(
  $q$SELECT pg_temp.add_participant('live', pg_temp.today_syd() + 1, 'livefuture@example.com')$q$,
  '23514', 'participant eligibility: dob_invalid', 'a future date of birth is refused'
);
SELECT throws_ok(
  $q$SELECT pg_temp.add_participant('live', pg_temp.years_before(pg_temp.today_syd(), 121), 'liveold@example.com')$q$,
  '23514', 'participant eligibility: dob_invalid', 'an age over 120 is refused'
);
SELECT lives_ok(
  $q$SELECT pg_temp.add_participant('live', pg_temp.years_before(pg_temp.today_syd(), 120), 'live120@example.com')$q$,
  'an age of exactly 120 is accepted'
);
SELECT throws_ok(
  $q$SELECT pg_temp.add_participant('live', '-infinity'::date, 'liveinf@example.com')$q$,
  '23514', 'participant eligibility: dob_invalid', 'a date of birth that is not finite is refused'
);
SELECT throws_ok(
  $q$SELECT pg_temp.add_participant('far', pg_temp.years_before(pg_temp.today_syd(), 12), 'far12@example.com')$q$,
  '23514', 'participant eligibility: under_minimum_age', '12 today is refused, though they will be 14 by a start date two years off'
);
SELECT lives_ok(
  $q$SELECT pg_temp.add_participant('far', pg_temp.years_before(pg_temp.today_syd(), 13), 'far13@example.com')$q$,
  '13 today and over the floor on the day is accepted'
);
SELECT throws_ok(
  $q$SELECT pg_temp.add_participant('min16', pg_temp.years_before(pg_temp.event_day(), 15), 'min15@example.com')$q$,
  '23514', 'participant eligibility: under_minimum_age', 'an event minimum of 16 raises the floor'
);
SELECT lives_ok(
  $q$SELECT pg_temp.add_participant('min16', pg_temp.years_before(pg_temp.event_day(), 16), 'min16@example.com')$q$,
  '16 on the day meets an event minimum of 16'
);
SELECT throws_ok(
  $q$SELECT pg_temp.add_participant('min10', pg_temp.years_before(pg_temp.event_day(), 14) + 1, 'min10a@example.com')$q$,
  '23514', 'participant eligibility: under_minimum_age', 'an event minimum of 10 cannot lower the floor'
);
SELECT lives_ok(
  $q$SELECT pg_temp.add_participant('min10', pg_temp.years_before(pg_temp.event_day(), 14), 'min10b@example.com')$q$,
  'an event minimum of 10 leaves the floor at 14'
);
SELECT throws_ok(
  $q$SELECT pg_temp.add_participant('tenant16', pg_temp.years_before(pg_temp.event_day(), 15), 'ten15@example.com')$q$,
  '23514', 'participant eligibility: under_minimum_age', 'a tenant minimum of 16 raises the floor'
);
SELECT lives_ok(
  $q$SELECT pg_temp.add_participant('tenant16', pg_temp.years_before(pg_temp.event_day(), 16), 'ten16@example.com')$q$,
  '16 on the day meets a tenant minimum of 16'
);
SELECT throws_ok(
  $q$SELECT pg_temp.add_participant('campaign', pg_temp.years_before(pg_temp.today_syd(), 14) + 1, 'camp13@example.com')$q$,
  '23514', 'participant eligibility: under_minimum_age', 'a campaign with no date takes age today: a day short of 14 is refused'
);
SELECT lives_ok(
  $q$SELECT pg_temp.add_participant('campaign', pg_temp.years_before(pg_temp.today_syd(), 14), 'camp14@example.com')$q$,
  'a campaign with no date takes age today: 14 is accepted'
);
SELECT throws_ok(
  $q$SELECT pg_temp.add_participant('undated', pg_temp.years_before(pg_temp.today_syd(), 30), 'undated@example.com')$q$,
  '23514', 'participant eligibility: start_date_missing', 'a live event with no start date refuses everyone'
);
SELECT throws_ok(
  $q$SELECT pg_temp.add_participant('badzone', pg_temp.years_before(pg_temp.today_syd(), 30), 'badzone@example.com')$q$,
  '23514', 'participant eligibility: time_zone_invalid', 'an event in a time zone Postgres does not know refuses everyone'
);

-- "Today" is the event's. These two zones are 25 hours apart, so UTC's date always
-- differs from at least one of them: a rule using UTC fails one of these at any hour.
SELECT lives_ok(
  $q$SELECT pg_temp.add_participant('ahead', pg_temp.years_before((now() AT TIME ZONE 'Pacific/Kiritimati')::date, 14), 'ahead14@example.com')$q$,
  'a campaign takes today in its own zone: turning 14 today in the zone furthest ahead is accepted'
);
SELECT throws_ok(
  $q$SELECT pg_temp.add_participant('behind', pg_temp.years_before((now() AT TIME ZONE 'Pacific/Pago_Pago')::date, 14) + 1, 'behind13@example.com')$q$,
  '23514', 'participant eligibility: under_minimum_age', 'a campaign takes today in its own zone: turning 14 tomorrow in the zone furthest behind is refused'
);

-- The session's time zone plays no part.
SET LOCAL TIME ZONE 'Pacific/Pago_Pago';
SELECT throws_ok(
  $q$SELECT pg_temp.add_participant('live', pg_temp.years_before(pg_temp.event_day(), 14) + 1, 'livetz13@example.com')$q$,
  '23514', 'participant eligibility: under_minimum_age', 'in a far-off session time zone, a day short of 14 is still refused'
);
SELECT lives_ok(
  $q$SELECT pg_temp.add_participant('live', pg_temp.years_before(pg_temp.event_day(), 14), 'livetz14@example.com')$q$,
  'in a far-off session time zone, 14 on the local start date is still accepted'
);
SET LOCAL TIME ZONE DEFAULT;

-- Updates.
SELECT throws_ok(
  $q$UPDATE public.participants SET date_of_birth = pg_temp.years_before(pg_temp.event_day(), 13) WHERE email = 'live14@example.com'$q$,
  '23514', 'participant eligibility: under_minimum_age', 'changing a date of birth to one under the floor is refused'
);
SELECT pg_temp.add_registration('mover', 'elig-stellr', NULL);
SELECT pg_temp.add_participant('mover', pg_temp.years_before(pg_temp.today_syd(), 12), 'mover12@example.com');
SELECT throws_ok(
  $q$UPDATE public.participants SET registration_id = (SELECT id FROM public.registrations WHERE event_title = 'live') WHERE email = 'mover12@example.com'$q$,
  '23514', 'participant eligibility: under_minimum_age', 'moving a participant onto a tenant event registration is refused'
);
ALTER TABLE public.participants DISABLE TRIGGER zzz_participants_assert_eligible;
SELECT pg_temp.add_participant('live', pg_temp.years_before(pg_temp.event_day(), 13), 'legacy13@example.com');
ALTER TABLE public.participants ENABLE TRIGGER zzz_participants_assert_eligible;
SELECT lives_ok(
  $q$UPDATE public.participants SET date_of_birth = date_of_birth WHERE email = 'legacy13@example.com'$q$,
  'a save that names date_of_birth without changing it does not re-judge the row'
);
SELECT lives_ok(
  $q$UPDATE public.participants SET nickname = 'Nick' WHERE email = 'legacy13@example.com'$q$,
  'an update to another column does not re-judge the row'
);
DELETE FROM public.participants WHERE email = 'legacy13@example.com';
SELECT throws_ok(
  $q$INSERT INTO public.participants (registration_id, first_name, last_name, email, phone, date_of_birth, gender, t_shirt_size, school_name, age_bracket, event_role)
     VALUES ('b1000000-0000-4000-8000-00000000dead', 'Pg', 'Tap', 'orphan@example.com', '0', '2000-01-01', '', 'M', '', 'high_school', 'participant')$q$,
  '23503', NULL, 'a registration that does not exist is still the foreign key''s refusal'
);

-- ── 3. Stellr is untouched ───────────────────────────────────────────────────

SELECT lives_ok(
  $q$SELECT pg_temp.add_participant('stellr', pg_temp.years_before(pg_temp.today_syd(), 12), 'st12@example.com')$q$,
  'Stellr, mirrored event: a 12-year-old inserts'
);
SELECT lives_ok(
  $q$SELECT pg_temp.add_participant('stellr', pg_temp.years_before(pg_temp.today_syd(), 13), 'st13@example.com')$q$,
  'Stellr, mirrored event: a 13-year-old inserts'
);
SELECT lives_ok(
  $q$SELECT pg_temp.add_participant('stellr', pg_temp.years_before(pg_temp.today_syd(), 121), 'stold@example.com')$q$,
  'Stellr, mirrored event: an over-120 date inserts, because Stellr''s date rules stay in the app'
);
SELECT lives_ok(
  $q$SELECT pg_temp.add_participant('stellr', pg_temp.today_syd() + 1, 'stfuture@example.com')$q$,
  'Stellr, mirrored event: a future date inserts, because Stellr''s date rules stay in the app'
);
SELECT throws_ok(
  $q$SELECT pg_temp.add_participant('stellr', NULL, 'stnull@example.com')$q$,
  '23502', NULL, 'Stellr: a NULL date of birth is still the column''s own NOT NULL refusal'
);
SELECT pg_temp.add_registration('st-unmirrored', 'elig-unmirrored-a', '00000000-0000-4000-8000-000000000001');
SELECT lives_ok(
  $q$SELECT pg_temp.add_participant('st-unmirrored', pg_temp.years_before(pg_temp.today_syd(), 12), 'stu12@example.com')$q$,
  'no events row, Stellr tenant_id: a 12-year-old inserts'
);
ALTER TABLE public.registrations DISABLE TRIGGER zz_tenancy_derive_tenant_id;
SELECT pg_temp.add_registration('null-tenant', 'elig-unmirrored-b', NULL);
ALTER TABLE public.registrations ENABLE TRIGGER zz_tenancy_derive_tenant_id;
SELECT is((SELECT tenant_id FROM public.registrations WHERE event_title = 'null-tenant'), NULL::uuid, 'fixture: a registration the backfill has not reached has a NULL tenant_id');
SELECT lives_ok(
  $q$SELECT pg_temp.add_participant('null-tenant', pg_temp.years_before(pg_temp.today_syd(), 12), 'stn12@example.com')$q$,
  'no events row, NULL tenant_id: a 12-year-old inserts'
);
SELECT lives_ok(
  $q$SELECT * FROM public.rename_event_slug('elig-unmirrored-a', 'elig-unmirrored-a2')$q$,
  'a Stellr slug rename with participants is not refused'
);

-- ── 4. No events row and a tenant other than Stellr ──────────────────────────

SELECT pg_temp.add_registration('supplied', 'elig-unmirrored-c', 'a1000000-0000-4000-8000-000000000001');
SELECT is((SELECT tenant_id FROM public.registrations WHERE event_title = 'supplied'), 'a1000000-0000-4000-8000-000000000001'::uuid, 'fixture: a supplied tenant_id is kept when the mirror has no event');
SELECT throws_ok(
  $q$SELECT pg_temp.add_participant('supplied', pg_temp.years_before(pg_temp.today_syd(), 30), 'sup30@example.com')$q$,
  '23514', 'participant eligibility: event_missing', 'no events row and another tenant''s id refuses even an adult'
);

-- ── 5. A tenant slug with no events row and no supplied tenant_id ────────────
-- Log mode PINS A KNOWN GAP (docs/TENANCY-S5.md, A3): derivation stamps the row
-- Stellr, so this check sees Stellr and admits a 13-year-old. Enforce refuses that
-- row only because no tenant_id was supplied. A supplied Stellr id is kept, and the
-- database cannot tell it from a real unmirrored Stellr event, so once writers
-- supply tenant_id (A7, A8) the protection is their resolver, not enforce.

DELETE FROM public.tenancy_derivation_log;
SELECT pg_temp.add_registration('gap', 'elig-tenant-slug-unmirrored', NULL);
SELECT is((SELECT tenant_id FROM public.registrations WHERE event_title = 'gap'), '00000000-0000-4000-8000-000000000001'::uuid, 'log mode: the unmirrored slug is stamped Stellr');
SELECT is((SELECT COALESCE(sum(count), 0)::int FROM public.tenancy_derivation_log WHERE table_name = 'public.registrations' AND reason = 'no_event'), 1, 'log mode: only the no_event log entry tells it from a real Stellr row');
SELECT lives_ok(
  $q$SELECT pg_temp.add_participant('gap', pg_temp.years_before(pg_temp.today_syd(), 13), 'gap13@example.com')$q$,
  'log mode: the known gap, a 13-year-old is accepted on the unmirrored slug'
);

UPDATE public.tenancy_settings SET derivation_mode = 'enforce';
SELECT throws_ok(
  $q$SELECT pg_temp.add_registration('gap-enforce', 'elig-tenant-slug-unmirrored', NULL)$q$,
  '23503', NULL, 'enforce mode: the same registration is refused while it supplies no tenant_id'
);
SELECT lives_ok(
  $q$SELECT pg_temp.add_registration('st-enforce', 'elig-unmirrored-d', '00000000-0000-4000-8000-000000000001')$q$,
  'enforce mode: an unmirrored Stellr event still registers when the writer supplies tenant_id'
);
SELECT lives_ok(
  $q$SELECT pg_temp.add_participant('st-enforce', pg_temp.years_before(pg_temp.today_syd(), 12), 'ste12@example.com')$q$,
  'enforce mode: a 12-year-old still inserts on a slug the mirror does not have once it is stamped Stellr, so the writer''s resolver decides'
);
SELECT lives_ok(
  $q$SELECT pg_temp.add_registration('st-enforce-mirrored', 'elig-stellr', NULL)$q$,
  'enforce mode: a mirrored Stellr event still registers with no tenant_id supplied'
);
SELECT lives_ok(
  $q$SELECT pg_temp.add_participant('st-enforce-mirrored', pg_temp.years_before(pg_temp.today_syd(), 12), 'stm12@example.com')$q$,
  'enforce mode: a 12-year-old still inserts on that mirrored Stellr event'
);
UPDATE public.tenancy_settings SET derivation_mode = 'log';

-- ── 6. A registration moving event or tenant ─────────────────────────────────

SELECT pg_temp.add_registration('move-13', 'elig-stellr', NULL);
SELECT pg_temp.add_participant('move-13', pg_temp.years_before(pg_temp.today_syd(), 13), 'move13@example.com');
SELECT throws_ok(
  $q$UPDATE public.registrations SET event_slug = 'elig-target' WHERE event_title = 'move-13'$q$,
  '23514', 'participant eligibility: under_minimum_age', 'a registration holding a 13-year-old cannot move onto a tenant event'
);
SELECT lives_ok(
  $q$UPDATE public.registrations SET event_slug = 'elig-unmirrored-e' WHERE event_title = 'move-13'$q$,
  'the same registration can move to an unmirrored event while it stays Stellr'
);
SELECT pg_temp.add_registration('move-adult', 'elig-stellr', NULL);
SELECT pg_temp.add_participant('move-adult', pg_temp.years_before(pg_temp.today_syd(), 30), 'moveadult@example.com');
SELECT lives_ok(
  $q$UPDATE public.registrations SET event_slug = 'elig-target' WHERE event_title = 'move-adult'$q$,
  'a registration of adults can move onto a tenant event'
);
SELECT is((SELECT tenant_id FROM public.registrations WHERE event_title = 'move-adult'), 'a1000000-0000-4000-8000-000000000001'::uuid, 'the move took the tenant event''s tenant');
SELECT throws_ok(
  $q$UPDATE public.registrations SET event_slug = 'elig-unmirrored-f' WHERE event_title = 'move-adult'$q$,
  '23514', 'participant eligibility: event_missing', 'a tenant''s registration with participants cannot move to a slug the mirror does not have'
);
SELECT pg_temp.add_registration('move-empty', 'elig-stellr', NULL);
SELECT lives_ok(
  $q$UPDATE public.registrations SET event_slug = 'elig-undated' WHERE event_title = 'move-empty'$q$,
  'a registration with no participants has nothing to re-check'
);

-- ── 7. A tenant event changing under its participants ────────────────────────

SELECT pg_temp.add_registration('recheck', 'elig-recheck', NULL);
SELECT pg_temp.add_participant('recheck', pg_temp.years_before(pg_temp.event_day(), 14), 'recheck14@example.com');
SELECT throws_ok(
  $q$UPDATE public.events SET min_participant_age = 16 WHERE slug = 'elig-recheck'$q$,
  '23514', 'participant eligibility: under_minimum_age', 'raising an event minimum over an existing participant is refused'
);
SELECT throws_ok(
  $q$UPDATE public.events SET starts_at = pg_temp.midnight_syd(pg_temp.event_day() - 60) WHERE slug = 'elig-recheck'$q$,
  '23514', 'participant eligibility: under_minimum_age', 'moving a start date to before a participant turns 14 is refused'
);
SELECT throws_ok(
  $q$UPDATE public.events SET starts_at = NULL WHERE slug = 'elig-recheck'$q$,
  '23514', 'participant eligibility: start_date_missing', 'removing a live event''s start date while it has participants is refused'
);
SELECT throws_ok(
  $q$UPDATE public.events SET tenant_id = 'a1000000-0000-4000-8000-000000000002' WHERE slug = 'elig-recheck'$q$,
  '23514', 'participant eligibility: under_minimum_age', 'moving an event to a tenant with a higher minimum is refused'
);
SELECT lives_ok(
  $q$SELECT pg_temp.add_participant('recheck', pg_temp.years_before(pg_temp.event_day(), 15), 'recheck15@example.com')$q$,
  'a refused raise leaves the old minimum in force: a new 15-year-old is still accepted'
);
SELECT lives_ok(
  $q$UPDATE public.events SET starts_at = pg_temp.midnight_syd(pg_temp.event_day() + 10) WHERE slug = 'elig-recheck'$q$,
  'moving a start date later keeps everyone eligible'
);
SELECT lives_ok(
  $q$UPDATE public.events SET min_participant_age = 16, starts_at = NULL WHERE slug = 'elig-recheck-empty'$q$,
  'a tenant event with no participants can change freely'
);
SELECT pg_temp.add_registration('stellr-moves', 'elig-stellr-moves', NULL);
SELECT pg_temp.add_participant('stellr-moves', pg_temp.years_before(pg_temp.today_syd(), 12), 'sm12@example.com');
SELECT lives_ok(
  $q$UPDATE public.events SET min_participant_age = 16, starts_at = pg_temp.midnight_syd(pg_temp.event_day() + 10) WHERE slug = 'elig-stellr-moves'$q$,
  'a Stellr event is not re-checked: its 12-year-old does not stop the change'
);
SELECT throws_ok(
  $q$UPDATE public.events SET tenant_id = 'a1000000-0000-4000-8000-000000000001' WHERE slug = 'elig-stellr-moves'$q$,
  '23514', 'participant eligibility: under_minimum_age', 'handing a Stellr event with a 12-year-old to a tenant is judged by the tenant''s rules'
);

-- A tenant event handed to Stellr: a Stellr event switches the rule off.
SELECT throws_ok(
  $q$UPDATE public.events SET tenant_id = '00000000-0000-4000-8000-000000000001' WHERE slug = 'elig-recheck'$q$,
  '23514', 'participant eligibility: tenant_handover', 'a tenant event with participants cannot be handed to Stellr'
);
SELECT throws_ok(
  $q$UPDATE public.events SET tenant_id = '00000000-0000-4000-8000-000000000001' WHERE slug = 'elig-undated'$q$,
  '23514', 'participant eligibility: tenant_handover', 'a tenant event with registrations and no participants yet cannot be handed to Stellr'
);
SELECT lives_ok(
  $q$UPDATE public.events SET tenant_id = '00000000-0000-4000-8000-000000000001' WHERE slug = 'elig-recheck-empty'$q$,
  'a tenant event with no registrations can be handed to Stellr'
);

-- A time zone or slug change can change the answer.
SELECT pg_temp.add_registration('zone', 'elig-zone', NULL);
SELECT pg_temp.add_participant('zone', pg_temp.years_before(pg_temp.event_day(), 14), 'zone14@example.com');
SELECT throws_ok(
  $q$UPDATE public.events SET time_zone = 'Pacific/Pago_Pago' WHERE slug = 'elig-zone'$q$,
  '23514', 'participant eligibility: under_minimum_age', 'a time zone that moves the local start date to before a participant turns 14 is refused'
);
SELECT throws_ok(
  $q$UPDATE public.events SET time_zone = 'Mars/Olympus_Mons' WHERE slug = 'elig-zone'$q$,
  '23514', 'participant eligibility: time_zone_invalid', 'a time zone Postgres does not know is refused while the event has participants'
);
SELECT pg_temp.add_registration('slug-to', 'elig-slug-to', '00000000-0000-4000-8000-000000000001');
SELECT pg_temp.add_participant('slug-to', pg_temp.years_before(pg_temp.today_syd(), 13), 'slugto13@example.com');
SELECT throws_ok(
  $q$UPDATE public.events SET slug = 'elig-slug-to' WHERE slug = 'elig-slug-from'$q$,
  '23514', 'participant eligibility: under_minimum_age', 'a tenant event renamed onto a slug holding an ineligible participant is refused'
);

-- A write that changes nothing does not re-judge the row. The participant here does
-- not meet the rule, so each lives_ok fails if its WHEN clause is removed, and the
-- throws_ok beside it proves that participant would be refused.
SELECT pg_temp.add_registration('nochange', 'elig-nochange', NULL);
ALTER TABLE public.participants DISABLE TRIGGER zzz_participants_assert_eligible;
SELECT pg_temp.add_participant('nochange', pg_temp.years_before(pg_temp.event_day(), 13), 'nochange13@example.com');
ALTER TABLE public.participants ENABLE TRIGGER zzz_participants_assert_eligible;
SELECT lives_ok(
  $q$UPDATE public.events SET starts_at = starts_at, min_participant_age = min_participant_age, tenant_id = tenant_id, time_zone = time_zone, slug = slug WHERE slug = 'elig-nochange'$q$,
  'an event sync that rewrites the same values does not re-judge its participants'
);
SELECT throws_ok(
  $q$UPDATE public.events SET starts_at = pg_temp.midnight_syd(pg_temp.event_day() + 1) WHERE slug = 'elig-nochange'$q$,
  '23514', 'participant eligibility: under_minimum_age', 'the same participant is judged once the start date really changes'
);
SELECT lives_ok(
  $q$UPDATE public.registrations SET event_slug = event_slug, tenant_id = tenant_id WHERE event_title = 'nochange'$q$,
  'a registration save that rewrites the same values does not re-judge its participants'
);
SELECT throws_ok(
  $q$UPDATE public.registrations SET event_slug = 'elig-target' WHERE event_title = 'nochange'$q$,
  '23514', 'participant eligibility: under_minimum_age', 'the same registration is judged once it really moves'
);

SELECT * FROM finish();
ROLLBACK;
