-- Backfill members.deleted_at for accounts that are inactive but undated.
--
-- Survey data is kept 7 years after account deactivation, and the clock is
-- members.deleted_at (lib/survey/retention.ts; retention schedule row 27).
-- Every deactivation path sets is_active = false and deleted_at together, but
-- older rows were deactivated without a date, so they had no clock and would
-- never be purged. David decided on 2 Oct 2026 to start their clock that day.
--
-- Data only: no schema change, so no GRANTs are needed. Each row updated
-- writes a normal members audit_log entry (trg_audit_members).

UPDATE public.members
   SET deleted_at = '2026-10-02 00:00:00-06'
 WHERE is_active = false
   AND deleted_at IS NULL;
