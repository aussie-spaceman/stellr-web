-- The Staff role, phase 4: who looked at what (14 Nov 2026).
--
-- Staff read the whole admin portal, which holds minors' records: names, dates of
-- birth, medical notes, emergency contacts. Leading practice (OWASP logging, NIST
-- AC-6(9), COPPA §312.8's annual internal-risk review) and the owner's decision of
-- 13 Nov: log each view of a minor's record and each export, by IDs only, so a
-- quietly over-reading account can be seen and a breach can be scoped.
--
--   record_access_log  append-only: one row per view or export. IDs, the route
--                      and a count; never a name, a date of birth or contact
--                      details. Nobody can change or delete a row, the service
--                      role included (a trigger and a revoke, as survey_access_log).
--   member_activity_log.actor_type gains 'staff', so a Staff change is never
--                      written down as an admin's.
--
-- Stellr only: the admin portal is Stellr's (lib/authz). Retention: 3 years, the
-- Staff term (docs/compliance/retention-schedule.md); a purge job is an open item.

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.record_access_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at                  timestamptz NOT NULL DEFAULT now(),
  -- Clerk user id of whoever looked, and the portal role they held then.
  actor               text NOT NULL,
  actor_role          text NOT NULL CHECK (actor_role IN ('admin', 'staff', 'event_manager', 'unknown')),
  action              text NOT NULL CHECK (action IN ('minor_record_view', 'roster_view', 'export')),
  -- What was looked at: a member, an event, or both. IDs only.
  subject_member_id   uuid,
  -- The event looked at, by slug: a reference, not ownership (the row is Stellr's log).
  subject_event       text,
  route               text NOT NULL,
  row_count           int CHECK (row_count IS NULL OR row_count >= 0),
  -- Small, ID-only facts: the export kind, the filter keys used. Never PII.
  detail              jsonb
);

CREATE INDEX IF NOT EXISTS record_access_log_at_idx ON public.record_access_log (at DESC);
CREATE INDEX IF NOT EXISTS record_access_log_actor_at_idx ON public.record_access_log (actor, at DESC);
CREATE INDEX IF NOT EXISTS record_access_log_subject_idx ON public.record_access_log (subject_member_id) WHERE subject_member_id IS NOT NULL;

COMMENT ON TABLE public.record_access_log IS
  'Append-only record of admin-portal views of minors'' records and of exports (Staff role phase 4, lib/record-access-log.ts). IDs only. Service role may insert and read, never change or delete.';

CREATE OR REPLACE FUNCTION public.record_access_log_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'record_access_log is append-only';
END $$;
REVOKE EXECUTE ON FUNCTION public.record_access_log_append_only() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS record_access_log_append_only ON public.record_access_log;
CREATE TRIGGER record_access_log_append_only
  BEFORE UPDATE OR DELETE ON public.record_access_log
  FOR EACH ROW EXECUTE FUNCTION public.record_access_log_append_only();

ALTER TABLE public.record_access_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.record_access_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.record_access_log TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON public.record_access_log FROM service_role;
DO $$ BEGIN
  CREATE POLICY "service role reads and appends record_access_log"
    ON public.record_access_log FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── The activity log names Staff ─────────────────────────────────────────────

ALTER TABLE public.member_activity_log DROP CONSTRAINT IF EXISTS member_activity_log_actor_type_check;
ALTER TABLE public.member_activity_log
  ADD CONSTRAINT member_activity_log_actor_type_check
  CHECK (actor_type IN ('admin', 'staff', 'member', 'system', 'stripe', 'docusign'));
