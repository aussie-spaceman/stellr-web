-- esign_access_log names Staff (staff-role.10).
--
-- A Stellr Staff member who opens or downloads a signed record is Staff, not an
-- admin. lib/esign/archive.ts AccessEntry already takes 'staff'; this lets the
-- table hold it. Only the CHECK widens: the column type is unchanged, so no row
-- is rewritten, and every existing value ('admin', 'member', 'signer',
-- 'system') stays valid. Validating the new constraint reads the table once;
-- the access log is small.
--
-- The constraint is the column CHECK from 20261002173459_esign_provider_archive.sql,
-- which Postgres named esign_access_log_actor_type_check. Re-running this file
-- drops and re-adds the same constraint.
--
-- pgTAP: supabase/tests/database/esign_access_log_staff_actor.test.sql.

ALTER TABLE public.esign_access_log DROP CONSTRAINT IF EXISTS esign_access_log_actor_type_check;
ALTER TABLE public.esign_access_log
  ADD CONSTRAINT esign_access_log_actor_type_check
  CHECK (actor_type IN ('admin', 'staff', 'member', 'signer', 'system'));
