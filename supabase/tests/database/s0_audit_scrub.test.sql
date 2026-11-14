-- pgTAP: S0 audit scrub (supabase/migrations/20261114030557_s0_audit_scrub_trigger.sql,
-- docs/THREAT-MODEL.md TB4 I). Runs in the CI `db` job against a database built
-- from supabase/baseline.sql + every timestamped migration. Everything rolls back.
--
-- What it pins: the audit trigger function still runs on members, and the row
-- images it writes to audit_log carry no health, dietary, emergency-contact or
-- guardian-contact key (plaintext, `_enc` or `_bidx`) on INSERT, UPDATE or
-- DELETE, while the non-sensitive columns and the change itself are still
-- recorded; the member row keeps its values (only the copy is scrubbed). The
-- same function attached to participants, for this transaction only, scrubs a
-- participant UPDATE the same way: participants has no audit trigger today, so
-- this proves the function is safe if one is ever added.
--
-- Values are placeholders. The key list between the markers below is checked
-- against SCRUB_KEYS by scripts/scrub-audit-health.test.ts.
BEGIN;
SET LOCAL search_path = extensions, public;

SELECT plan(22);

-- ── Fixtures ─────────────────────────────────────────────────────────────────

CREATE FUNCTION pg_temp.scrub_keys() RETURNS text[] LANGUAGE sql IMMUTABLE AS $f$
  -- scrub-keys:begin
  SELECT ARRAY[
    'dietary_requirements',
    'dietary_requirements_enc',
    'ec_email',
    'ec_email_bidx',
    'ec_email_enc',
    'ec_first_name',
    'ec_first_name_enc',
    'ec_last_name',
    'ec_last_name_enc',
    'ec_phone',
    'ec_phone_bidx',
    'ec_phone_enc',
    'ec_relationship',
    'ec_relationship_enc',
    'emergency_contact_email',
    'emergency_contact_email_bidx',
    'emergency_contact_email_enc',
    'emergency_contact_first_name',
    'emergency_contact_first_name_enc',
    'emergency_contact_last_name',
    'emergency_contact_last_name_enc',
    'emergency_contact_phone',
    'emergency_contact_phone_bidx',
    'emergency_contact_phone_enc',
    'emergency_contact_relationship',
    'emergency_contact_relationship_enc',
    'guardian_email',
    'guardian_email_bidx',
    'guardian_email_enc',
    'guardian_name',
    'guardian_name_enc',
    'health_conditions',
    'health_conditions_enc'
  ]::text[];
  -- scrub-keys:end
$f$;

-- The scrubbed columns that exist on each audited table (S4 catalogue).
CREATE FUNCTION pg_temp.member_keys() RETURNS text[] LANGUAGE sql IMMUTABLE AS $f$
  SELECT ARRAY['health_conditions', 'health_conditions_enc',
               'ec_first_name', 'ec_first_name_enc', 'ec_last_name', 'ec_last_name_enc',
               'ec_email', 'ec_email_enc', 'ec_email_bidx', 'ec_phone', 'ec_phone_enc', 'ec_phone_bidx',
               'ec_relationship', 'ec_relationship_enc']::text[]
$f$;
CREATE FUNCTION pg_temp.participant_keys() RETURNS text[] LANGUAGE sql IMMUTABLE AS $f$
  SELECT ARRAY['health_conditions', 'health_conditions_enc', 'dietary_requirements', 'dietary_requirements_enc',
               'emergency_contact_first_name', 'emergency_contact_first_name_enc',
               'emergency_contact_last_name', 'emergency_contact_last_name_enc',
               'emergency_contact_email', 'emergency_contact_email_enc', 'emergency_contact_email_bidx',
               'emergency_contact_phone', 'emergency_contact_phone_enc', 'emergency_contact_phone_bidx',
               'emergency_contact_relationship', 'emergency_contact_relationship_enc']::text[]
$f$;

CREATE FUNCTION pg_temp.audit_row(p_table text, p_id uuid, p_action text) RETURNS public.audit_log
LANGUAGE sql STABLE AS $f$
  SELECT a.* FROM public.audit_log a
   WHERE a.table_name = p_table AND a.record_id = p_id AND a.action::text = p_action
   ORDER BY a.changed_at DESC LIMIT 1
$f$;

-- ── 1. The function and its trigger ──────────────────────────────────────────

SELECT has_function('public', 'audit_members', ARRAY[]::name[], 'audit_members() exists');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_trigger tg
   WHERE tg.tgrelid = 'public.members'::regclass AND tg.tgname = 'trg_audit_members'
     AND tg.tgfoid = 'public.audit_members()'::regprocedure AND tg.tgenabled = 'O'
), 'members: trg_audit_members still calls audit_members() and is enabled');
SELECT ok(
  (SELECT NOT prosecdef FROM pg_proc WHERE oid = 'public.audit_members()'::regprocedure),
  'audit_members() is not SECURITY DEFINER'
);

-- ── 2. members: INSERT, UPDATE, DELETE ───────────────────────────────────────

INSERT INTO public.members (id, first_name, last_name, email, event_role,
                            health_conditions, ec_first_name, ec_last_name, ec_email, ec_phone, ec_relationship)
VALUES ('e5000000-0000-4000-8000-000000000001', 'Before', 'Scrub', 's0-scrub-member@example.test', 'participant',
        'placeholder condition', 'Placeholder', 'Contact', 's0-scrub-contact@example.test', '000', 'placeholder');

SELECT ok(
  (SELECT to_jsonb(m) ?& pg_temp.member_keys() FROM public.members m WHERE m.id = 'e5000000-0000-4000-8000-000000000001'),
  'members: an unscrubbed row image carries every sensitive key (so the checks below mean something)'
);
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE table_name = 'members' AND record_id = 'e5000000-0000-4000-8000-000000000001'),
  1, 'members INSERT: one audit row'
);
SELECT ok(
  NOT ((pg_temp.audit_row('members', 'e5000000-0000-4000-8000-000000000001', 'INSERT')).new_data ?| pg_temp.scrub_keys()),
  'members INSERT: new_data holds no health or emergency-contact key'
);
SELECT is(
  (pg_temp.audit_row('members', 'e5000000-0000-4000-8000-000000000001', 'INSERT')).new_data ->> 'email',
  's0-scrub-member@example.test', 'members INSERT: the non-sensitive columns are recorded'
);

UPDATE public.members
   SET first_name = 'After', health_conditions = 'placeholder condition updated', ec_phone = '111', ec_relationship = 'other'
 WHERE id = 'e5000000-0000-4000-8000-000000000001';

SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE table_name = 'members' AND record_id = 'e5000000-0000-4000-8000-000000000001' AND action::text = 'UPDATE'),
  1, 'members UPDATE: one audit row'
);
SELECT ok(
  NOT ((pg_temp.audit_row('members', 'e5000000-0000-4000-8000-000000000001', 'UPDATE')).old_data ?| pg_temp.scrub_keys()),
  'members UPDATE: old_data holds no health or emergency-contact key'
);
SELECT ok(
  NOT ((pg_temp.audit_row('members', 'e5000000-0000-4000-8000-000000000001', 'UPDATE')).new_data ?| pg_temp.scrub_keys()),
  'members UPDATE: new_data holds no health or emergency-contact key'
);
SELECT is(
  (pg_temp.audit_row('members', 'e5000000-0000-4000-8000-000000000001', 'UPDATE')).old_data ->> 'first_name',
  'Before', 'members UPDATE: old_data keeps the non-sensitive value before the change'
);
SELECT is(
  (pg_temp.audit_row('members', 'e5000000-0000-4000-8000-000000000001', 'UPDATE')).new_data ->> 'first_name',
  'After', 'members UPDATE: new_data keeps the non-sensitive change'
);
SELECT is(
  (SELECT health_conditions || '|' || ec_phone FROM public.members WHERE id = 'e5000000-0000-4000-8000-000000000001'),
  'placeholder condition updated|111', 'members UPDATE: the member row itself keeps its values; only the audit copy is scrubbed'
);

DELETE FROM public.members WHERE id = 'e5000000-0000-4000-8000-000000000001';

SELECT ok(
  NOT ((pg_temp.audit_row('members', 'e5000000-0000-4000-8000-000000000001', 'DELETE')).old_data ?| pg_temp.scrub_keys()),
  'members DELETE: old_data holds no health or emergency-contact key'
);
SELECT is(
  (pg_temp.audit_row('members', 'e5000000-0000-4000-8000-000000000001', 'DELETE')).old_data ->> 'first_name',
  'After', 'members DELETE: old_data keeps the non-sensitive columns'
);
SELECT ok(
  (pg_temp.audit_row('members', 'e5000000-0000-4000-8000-000000000001', 'DELETE')).new_data IS NULL,
  'members DELETE: new_data is NULL, as before'
);

-- ── 3. participants: the same function on an UPDATE ──────────────────────────

INSERT INTO public.events (tenant_id, slug, sanity_id, title, activity_type, starts_at, time_zone, country, currency, grade_system, min_participant_age)
VALUES ('00000000-0000-4000-8000-000000000001', 's0-scrub-live', 'pgtap-s0-scrub-live', 'PgTap s0-scrub-live', 'live_event',
        now() + interval '30 days', 'Australia/Sydney', 'AU', 'aud', 'au_years', NULL);
INSERT INTO public.registrations (id, event_slug, event_title, type, tenant_id)
VALUES ('e5000000-0000-4000-8000-000000000002', 's0-scrub-live', 's0 scrub', 'individual', '00000000-0000-4000-8000-000000000001');
INSERT INTO public.participants (id, registration_id, first_name, last_name, email, phone, date_of_birth, gender, t_shirt_size, school_name, age_bracket, event_role,
                                 health_conditions, dietary_requirements, emergency_contact_first_name, emergency_contact_last_name,
                                 emergency_contact_email, emergency_contact_phone, emergency_contact_relationship)
VALUES ('e5000000-0000-4000-8000-000000000003', 'e5000000-0000-4000-8000-000000000002', 'Pg', 'Scrub', 's0-scrub-participant@example.test', '0',
        (now() - interval '20 years')::date, '', 'M', 'Before School', 'high_school', 'participant',
        'placeholder condition', ARRAY['placeholder diet'], 'Placeholder', 'Contact',
        's0-scrub-contact@example.test', '000', 'placeholder');

-- Attached for this transaction only; the ROLLBACK below removes it.
CREATE TRIGGER pgtap_s0_audit_participants AFTER UPDATE ON public.participants
  FOR EACH ROW EXECUTE FUNCTION public.audit_members();

SELECT ok(
  (SELECT to_jsonb(p) ?& pg_temp.participant_keys() FROM public.participants p WHERE p.id = 'e5000000-0000-4000-8000-000000000003'),
  'participants: an unscrubbed row image carries every sensitive key'
);

UPDATE public.participants
   SET school_name = 'After School', health_conditions = 'placeholder condition updated',
       dietary_requirements = ARRAY['placeholder diet', 'another'], emergency_contact_phone = '111',
       emergency_contact_relationship = 'other'
 WHERE id = 'e5000000-0000-4000-8000-000000000003';

SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE table_name = 'participants' AND record_id = 'e5000000-0000-4000-8000-000000000003'),
  1, 'participants UPDATE: one audit row'
);
SELECT ok(
  NOT ((pg_temp.audit_row('participants', 'e5000000-0000-4000-8000-000000000003', 'UPDATE')).old_data ?| pg_temp.scrub_keys())
  AND NOT ((pg_temp.audit_row('participants', 'e5000000-0000-4000-8000-000000000003', 'UPDATE')).new_data ?| pg_temp.scrub_keys()),
  'participants UPDATE: neither image holds a medical, dietary or emergency-contact key'
);
SELECT is(
  (pg_temp.audit_row('participants', 'e5000000-0000-4000-8000-000000000003', 'UPDATE')).new_data ->> 'school_name',
  'After School', 'participants UPDATE: new_data keeps the non-sensitive change'
);
SELECT is(
  (pg_temp.audit_row('participants', 'e5000000-0000-4000-8000-000000000003', 'UPDATE')).old_data ->> 'school_name',
  'Before School', 'participants UPDATE: old_data keeps the value before the change'
);
SELECT is(
  (SELECT emergency_contact_phone FROM public.participants WHERE id = 'e5000000-0000-4000-8000-000000000003'),
  '111', 'participants UPDATE: the participant row itself keeps its values'
);

SELECT * FROM finish();
ROLLBACK;
