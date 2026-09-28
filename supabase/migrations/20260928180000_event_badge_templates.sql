-- Name badge templates, like certificate templates (20260925090000_event_awards).
-- Plan: docs/handovers/HANDOVER-avery-8395-badges-2026-09-25.md (session 21 addendum).
--
-- One background per Avery format (lib/badge-layout.ts) per audience:
--   everyone   the default — every badge without a more specific template
--   mentors    volunteer mentors and participants registered as mentors
--   company    every participant in one company (company_id)
-- A badge uses its company's template, else mentors', else everyone's.
-- Only the name is drawn, at a placement stored per template as fractions of
-- the label artwork. Upload pre-fills it from the rule the artwork leaves; an
-- admin can move it against a live preview.

CREATE TABLE IF NOT EXISTS public.event_badge_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_slug      text NOT NULL,
  format          text NOT NULL CHECK (format IN ('avery_5392', 'avery_8395')),
  audience        text NOT NULL CHECK (audience IN ('everyone', 'mentors', 'company')),
  company_id      uuid REFERENCES public.event_companies(id) ON DELETE CASCADE,
  artwork_path    text NOT NULL,
  -- Placement, as fractions of the label artwork (bleed included). NULL until
  -- set: the renderer then finds the artwork's rule itself. Rows carried over
  -- from event_settings below start that way.
  name_x          numeric CHECK (name_x > 0 AND name_x < 1),               -- centre, from the left
  name_y          numeric CHECK (name_y > 0 AND name_y < 1),               -- baseline, from the top
  name_max_width  numeric CHECK (name_max_width > 0 AND name_max_width <= 1),
  name_size       numeric CHECK (name_size BETWEEN 6 AND 72),              -- points; long names shrink
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((audience = 'company') = (company_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS event_badge_templates_audience_uq
  ON public.event_badge_templates (event_slug, format, audience)
  WHERE company_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS event_badge_templates_company_uq
  ON public.event_badge_templates (event_slug, format, company_id)
  WHERE company_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_badge_templates TO service_role;
ALTER TABLE public.event_badge_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access event_badge_templates"
    ON public.event_badge_templates FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER event_badge_templates_updated_at
    BEFORE UPDATE ON public.event_badge_templates
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Each event's existing backgrounds become its "everyone" templates. The
-- event_settings columns stay one release, unread.
INSERT INTO public.event_badge_templates (event_slug, format, audience, artwork_path)
SELECT event_slug, 'avery_5392', 'everyone', badge_artwork_path
FROM public.event_settings WHERE badge_artwork_path IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.event_badge_templates (event_slug, format, audience, artwork_path)
SELECT event_slug, 'avery_8395', 'everyone', badge_8395_artwork_path
FROM public.event_settings WHERE badge_8395_artwork_path IS NOT NULL
ON CONFLICT DO NOTHING;
