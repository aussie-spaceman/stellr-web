-- pgTAP: esign_access_log names Staff (staff-role.10,
-- supabase/migrations/*_esign_access_log_staff_actor.sql). Runs in the CI `db` job
-- against a database built from supabase/baseline.sql + every timestamped
-- migration. Everything rolls back.
--
-- What it pins: a 'staff' access row inserts; every value the table held before
-- still inserts; an actor type nobody defined is refused by the CHECK; and there
-- is exactly one CHECK on actor_type, so an old narrower one cannot linger.
BEGIN;
SET LOCAL search_path = extensions, public;

SELECT plan(5);

-- The rows name a tenant, so the inherit trigger needs no agreements row: the log
-- deliberately has no foreign key to the record it describes.
-- lib/tenancy/constants.ts STELLR_TENANT_ID.
CREATE TEMP TABLE eal_fixture ON COMMIT DROP AS
SELECT gen_random_uuid() AS envelope_row, '00000000-0000-4000-8000-000000000001'::uuid AS tenant_id;

SELECT lives_ok(
  $$ INSERT INTO public.esign_access_log (envelope_row, action, actor_type, actor_id, tenant_id)
     SELECT envelope_row, 'download', 'staff', 'user_placeholder_staff', tenant_id FROM eal_fixture $$,
  'a Staff download is recorded as staff');

SELECT is(
  (SELECT actor_type FROM public.esign_access_log l JOIN eal_fixture f USING (envelope_row) WHERE l.actor_id = 'user_placeholder_staff'),
  'staff',
  'the row reads back as staff');

SELECT lives_ok(
  $$ INSERT INTO public.esign_access_log (envelope_row, action, actor_type, actor_id, tenant_id)
     SELECT envelope_row, 'view', t, NULL, tenant_id FROM eal_fixture, unnest(ARRAY['admin', 'member', 'signer', 'system']) AS t $$,
  'every actor type the table held before still inserts');

SELECT throws_ok(
  $$ INSERT INTO public.esign_access_log (envelope_row, action, actor_type, actor_id, tenant_id)
     SELECT envelope_row, 'download', 'event_manager', NULL, tenant_id FROM eal_fixture $$,
  '23514',
  NULL,
  'an actor type the table does not define is refused');

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
    WHERE conrelid = 'public.esign_access_log'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%actor_type%'),
  1,
  'one CHECK governs actor_type');

SELECT * FROM finish();
ROLLBACK;
