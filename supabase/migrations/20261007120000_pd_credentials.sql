-- Educator PD credentials (7 Oct 2026) — docs/PLAN-educator-pd-2026-10-07.md
--
-- A teacher who supports an event is issued a credential recording the hours
-- they gave, mapped to a fixed set of standards: the certificate is evidence
-- for their licence renewal, and the credential page is what LinkedIn links to.
-- It is a fourth credential source rather than a new table — one wallet, one
-- page, one share flow — and a PD transcript later is a SUM over these rows.
--
-- Idempotent: safe to re-run under the CLI or the Supabase MCP.

ALTER TABLE public.credentials DROP CONSTRAINT IF EXISTS credentials_source_check;
ALTER TABLE public.credentials ADD CONSTRAINT credentials_source_check
  CHECK (source IN ('course', 'event', 'manual', 'pd'));

ALTER TABLE public.credentials
  ADD COLUMN IF NOT EXISTS pd_hours          numeric(4,1)
    CHECK (pd_hours IS NULL OR (pd_hours > 0 AND pd_hours <= 40)),
  -- Snapshot at issue, like title and issuer: changing the Stellr-wide set
  -- later must not rewrite a certificate already submitted to a state board.
  ADD COLUMN IF NOT EXISTS standards         text[] NOT NULL DEFAULT '{}',
  -- The event as the certificate prints it (title holds the LinkedIn name).
  ADD COLUMN IF NOT EXISTS activity_title    text,
  ADD COLUMN IF NOT EXISTS activity_date     date,
  ADD COLUMN IF NOT EXISTS activity_location text;

-- member_id is deliberately NOT required: erasure tombstones the row and the
-- FK then nulls member_id (ON DELETE SET NULL). Requiring it here would make
-- deleting an educator fail.
DO $$ BEGIN
  ALTER TABLE public.credentials ADD CONSTRAINT credentials_pd_shape
    CHECK (source <> 'pd' OR (pd_hours IS NOT NULL AND event_slug IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- One live PD credential per educator per event. Revoked rows fall out of the
-- index, so a correction is revoke + issue again (a new number — the LinkedIn
-- entry already copied the old title, hours included).
CREATE UNIQUE INDEX IF NOT EXISTS credentials_pd_once
  ON public.credentials (member_id, event_slug)
  WHERE source = 'pd' AND status = 'issued';

-- No new table; the grant is restated so an MCP apply cannot leave the
-- altered table unreadable (see 20260921120000_credentials.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.credentials TO service_role;
