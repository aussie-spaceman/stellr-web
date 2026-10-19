-- Norm Chaffee Finalist (19 Oct 2026): a sixth event award.
--
-- Nominated by the volunteer mentors and entered by an admin or event manager,
-- like the judged awards. Any number per event, but only students who hold
-- Overall Champion — the app enforces that, and clears picks when the champion
-- changes (lib/event-awards.ts). It joins the two specialist awards in the
-- one-per-student rule: a student holds at most one of anita_gale,
-- dick_edwards and norm_chaffee. It is not one-per-company, so the
-- one_per_company index is unchanged.
--
-- Idempotent: safe to re-run under the CLI or the Supabase MCP.

ALTER TABLE public.event_award_assignments DROP CONSTRAINT IF EXISTS event_award_assignments_award_type_check;
ALTER TABLE public.event_award_assignments ADD CONSTRAINT event_award_assignments_award_type_check
  CHECK (award_type IN ('overall_champion', 'anita_gale', 'dick_edwards', 'norm_chaffee'));

ALTER TABLE public.event_certificate_templates DROP CONSTRAINT IF EXISTS event_certificate_templates_award_type_check;
ALTER TABLE public.event_certificate_templates ADD CONSTRAINT event_certificate_templates_award_type_check
  CHECK (award_type IN ('participation', 'overall_champion', 'anita_gale', 'dick_edwards', 'norm_chaffee', 'mentor'));

ALTER TABLE public.credentials DROP CONSTRAINT IF EXISTS credentials_award_type_check;
ALTER TABLE public.credentials ADD CONSTRAINT credentials_award_type_check
  CHECK (award_type IS NULL OR award_type IN ('participation', 'overall_champion', 'anita_gale', 'dick_edwards', 'norm_chaffee', 'mentor'));

-- One individual award per student per event, now three to choose from.
DROP INDEX IF EXISTS public.event_award_assignments_one_specialist;
CREATE UNIQUE INDEX IF NOT EXISTS event_award_assignments_one_specialist
  ON public.event_award_assignments (event_slug, participant_id)
  WHERE award_type IN ('anita_gale', 'dick_edwards', 'norm_chaffee');

-- No new table; grants restated so an MCP apply cannot leave them unreadable.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_award_assignments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_certificate_templates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.credentials TO service_role;
