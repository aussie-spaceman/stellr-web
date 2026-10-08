-- Mentor credentials (8 Oct 2026) — docs/PLAN-mentor-credentials-2026-10-08.md
--
-- Volunteer mentors assigned to an event (the Volunteers panel) get their own
-- certificate — the Certificate of Appreciation — and a credential beside the
-- students' participation credential: same page, wallet, consent rules, email
-- and LinkedIn share. It is a fifth award type on the existing event source,
-- not a new source, so everything keyed on source='event' carries over.
--
-- Mentors have no participants row (they are cohort_members volunteers), so
-- the participant-keyed index cannot dedupe them; theirs is keyed on member.
--
-- Idempotent: safe to re-run under the CLI or the Supabase MCP.

ALTER TABLE public.event_certificate_templates DROP CONSTRAINT IF EXISTS event_certificate_templates_award_type_check;
ALTER TABLE public.event_certificate_templates ADD CONSTRAINT event_certificate_templates_award_type_check
  CHECK (award_type IN ('participation', 'overall_champion', 'anita_gale', 'dick_edwards', 'mentor'));

ALTER TABLE public.credentials DROP CONSTRAINT IF EXISTS credentials_award_type_check;
ALTER TABLE public.credentials ADD CONSTRAINT credentials_award_type_check
  CHECK (award_type IS NULL OR award_type IN ('participation', 'overall_champion', 'anita_gale', 'dick_edwards', 'mentor'));

-- One mentor credential per member per event, revoked included — like the
-- student awards, a revoked one is reinstated rather than issued again. member_id
-- is not required by a CHECK: erasure tombstones the row and the FK nulls it.
CREATE UNIQUE INDEX IF NOT EXISTS credentials_event_mentor_once
  ON public.credentials (member_id, event_slug)
  WHERE source = 'event' AND award_type = 'mentor';

-- The mentors' own wording, beside the students' credential_* columns.
ALTER TABLE public.event_settings
  ADD COLUMN IF NOT EXISTS mentor_credential_title       text,
  ADD COLUMN IF NOT EXISTS mentor_credential_description text,
  ADD COLUMN IF NOT EXISTS mentor_credential_criteria    text,
  ADD COLUMN IF NOT EXISTS mentor_credential_skills      text[] NOT NULL DEFAULT '{}';

-- No new table; grants restated so an MCP apply cannot leave them unreadable.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.credentials TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_certificate_templates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_settings TO service_role;
