-- Event awards: judged certificates + credentials beside participation.
-- Plan: docs/handovers (event award certificates, 25 Sept 2026).
--
-- The award set is fixed and global (lib/event-awards.ts):
--   participation     everyone — not assigned, so never in event_award_assignments
--   overall_champion  a team award; every student in the winning company
--   anita_gale        specialist — one winner per company
--   dick_edwards      specialist — one winner per company
-- A student holds at most one specialist award per event, so at most three
-- certificates: participation, champion, one specialist.

-- ─── event_certificate_templates ─────────────────────────────────────────────
-- One background per event per award. The artwork carries every word but the
-- name; the renderer draws only the name, at a position stored as fractions of
-- the artwork so it tracks the artwork on any paper size.
CREATE TABLE IF NOT EXISTS public.event_certificate_templates (
  event_slug      text NOT NULL,
  award_type      text NOT NULL CHECK (award_type IN ('participation', 'overall_champion', 'anita_gale', 'dick_edwards')),
  artwork_path    text NOT NULL,
  -- Name baseline, as a fraction of the artwork height from the top. The Canva
  -- set's rule sits at 0.57; 0.545 puts the baseline just above it.
  name_y          numeric NOT NULL DEFAULT 0.545 CHECK (name_y > 0 AND name_y < 1),
  -- Widest the name may run, as a fraction of the artwork width (the rule is 0.52).
  name_max_width  numeric NOT NULL DEFAULT 0.5 CHECK (name_max_width > 0 AND name_max_width <= 1),
  -- Starting size in points on US Letter; long names shrink to fit.
  name_size       numeric NOT NULL DEFAULT 40 CHECK (name_size BETWEEN 8 AND 120),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_slug, award_type)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_certificate_templates TO service_role;
ALTER TABLE public.event_certificate_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access event_certificate_templates"
    ON public.event_certificate_templates FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER event_certificate_templates_updated_at
    BEFORE UPDATE ON public.event_certificate_templates
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The single certificate background each event had becomes its participation
-- template. event_settings.certificate_artwork_path stays one release, unread.
INSERT INTO public.event_certificate_templates (event_slug, award_type, artwork_path)
SELECT event_slug, 'participation', certificate_artwork_path
FROM public.event_settings
WHERE certificate_artwork_path IS NOT NULL
ON CONFLICT (event_slug, award_type) DO NOTHING;

-- ─── event_award_assignments ─────────────────────────────────────────────────
-- Judging results, as a draft. Nothing here is visible to a student until an
-- admin issues awards, which turns each row into a credential.
CREATE TABLE IF NOT EXISTS public.event_award_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_slug      text NOT NULL,
  award_type      text NOT NULL CHECK (award_type IN ('overall_champion', 'anita_gale', 'dick_edwards')),
  participant_id  uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  -- Snapshot of participants.company_id at assignment: the per-company rule
  -- needs it in the row to be enforceable by an index.
  company_id      uuid REFERENCES public.event_companies(id) ON DELETE SET NULL,
  assigned_by     text,                               -- Clerk user id
  assigned_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS event_award_assignments_once
  ON public.event_award_assignments (event_slug, participant_id, award_type);
-- One specialist award per student per event.
CREATE UNIQUE INDEX IF NOT EXISTS event_award_assignments_one_specialist
  ON public.event_award_assignments (event_slug, participant_id)
  WHERE award_type IN ('anita_gale', 'dick_edwards');
-- One winner of each specialist award per company.
CREATE UNIQUE INDEX IF NOT EXISTS event_award_assignments_one_per_company
  ON public.event_award_assignments (event_slug, company_id, award_type)
  WHERE award_type IN ('anita_gale', 'dick_edwards');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_award_assignments TO service_role;
ALTER TABLE public.event_award_assignments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access event_award_assignments"
    ON public.event_award_assignments FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── credentials: one per award, not one per event ───────────────────────────
ALTER TABLE public.credentials
  ADD COLUMN IF NOT EXISTS award_type text
  CHECK (award_type IS NULL OR award_type IN ('participation', 'overall_champion', 'anita_gale', 'dick_edwards'));

UPDATE public.credentials SET award_type = 'participation'
WHERE source = 'event' AND award_type IS NULL;

-- A NULL award_type would slip past the unique index below (NULLs are
-- distinct), so an event credential must say which certificate it is.
DO $$ BEGIN
  ALTER TABLE public.credentials ADD CONSTRAINT credentials_event_award_type
    CHECK (source <> 'event' OR award_type IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP INDEX IF EXISTS public.credentials_event_once;
CREATE UNIQUE INDEX IF NOT EXISTS credentials_event_award_once
  ON public.credentials (participant_id, event_slug, award_type) WHERE source = 'event';

-- ─── event_settings ──────────────────────────────────────────────────────────
ALTER TABLE public.event_settings ADD COLUMN IF NOT EXISTS awards_issued_at timestamptz;
