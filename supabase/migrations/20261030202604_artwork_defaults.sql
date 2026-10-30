-- Default artwork for certificates and name badges, per competition theme.
--
-- Every certificate and badge slot now has a default for its theme (space |
-- environmental), and an event's own upload (event_certificate_templates,
-- event_badge_templates) overrides it:
--   certificate  event's template for the award → theme default → plain design
--   badge        event's templates (company, mentors, everyone) with each
--                missing mentors/everyone slot filled by the theme default
--                → plain badge
-- The educator PD certificate already has per-theme files
-- (pd-certificate/<theme>/…); its per-event override is files too, so it needs
-- no table here.
--
-- Admins change the defaults on Competitions → Default artwork. Before a
-- default certificate's artwork is replaced, the app copies the outgoing one to
-- every event that has issued that award on it, so a member's re-download never
-- changes (decision, 30 Oct 2026).

-- ─── default_certificate_templates ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.default_certificate_templates (
  theme           text NOT NULL CHECK (theme IN ('space', 'environmental')),
  award_type      text NOT NULL CHECK (award_type IN ('participation', 'overall_champion', 'anita_gale', 'dick_edwards', 'norm_chaffee', 'mentor')),
  artwork_path    text NOT NULL,
  -- As event_certificate_templates (20260925090000_event_awards).
  name_y          numeric NOT NULL DEFAULT 0.545 CHECK (name_y > 0 AND name_y < 1),
  name_max_width  numeric NOT NULL DEFAULT 0.5 CHECK (name_max_width > 0 AND name_max_width <= 1),
  name_size       numeric NOT NULL DEFAULT 40 CHECK (name_size BETWEEN 8 AND 120),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (theme, award_type)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.default_certificate_templates TO service_role;
ALTER TABLE public.default_certificate_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access default_certificate_templates"
    ON public.default_certificate_templates FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER default_certificate_templates_updated_at
    BEFORE UPDATE ON public.default_certificate_templates
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── default_badge_templates ─────────────────────────────────────────────────
-- Everyone and mentors only: companies belong to one event.
CREATE TABLE IF NOT EXISTS public.default_badge_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theme           text NOT NULL CHECK (theme IN ('space', 'environmental')),
  format          text NOT NULL CHECK (format IN ('avery_5392', 'avery_8395')),
  audience        text NOT NULL CHECK (audience IN ('everyone', 'mentors')),
  artwork_path    text NOT NULL,
  -- As event_badge_templates (20260928190000): NULL until positioned, and the
  -- renderer then finds the artwork's rule itself.
  name_x          numeric CHECK (name_x > 0 AND name_x < 1),
  name_y          numeric CHECK (name_y > 0 AND name_y < 1),
  name_max_width  numeric CHECK (name_max_width > 0 AND name_max_width <= 1),
  name_size       numeric CHECK (name_size BETWEEN 6 AND 72),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (theme, format, audience)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.default_badge_templates TO service_role;
ALTER TABLE public.default_badge_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access default_badge_templates"
    ON public.default_badge_templates FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER default_badge_templates_updated_at
    BEFORE UPDATE ON public.default_badge_templates
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Seed: the Colorado Space Design Challenge set becomes the Space default ──
-- The rows point at the same stored files as Colorado's own templates. Nothing
-- deletes event artwork, and Colorado keeps its own rows, so either can change
-- without moving the other. An environment without Colorado's templates seeds
-- nothing here.
INSERT INTO public.default_certificate_templates (theme, award_type, artwork_path, name_y, name_max_width, name_size)
SELECT 'space', award_type, artwork_path, name_y, name_max_width, name_size
FROM public.event_certificate_templates
WHERE event_slug = 'colorado-space-design-challenge'
ON CONFLICT (theme, award_type) DO NOTHING;

INSERT INTO public.default_badge_templates (theme, format, audience, artwork_path, name_x, name_y, name_max_width, name_size)
SELECT 'space', format, audience, artwork_path, name_x, name_y, name_max_width, name_size
FROM public.event_badge_templates
WHERE event_slug = 'colorado-space-design-challenge' AND audience IN ('everyone', 'mentors')
ON CONFLICT (theme, format, audience) DO NOTHING;

-- Colorado's Certificate of Appreciation was never positioned. At the starting
-- 0.545 the name runs through that artwork's rule, which sits higher than on
-- the award set (checked against a preview, 30 Oct 2026), so the default
-- starts just above it. Colorado's own row is left as it is.
UPDATE public.default_certificate_templates
SET name_y = 0.51
WHERE theme = 'space' AND award_type = 'mentor'
  AND name_y = 0.545 AND name_max_width = 0.5 AND name_size = 40;

-- Colorado printed only the Avery 8395 sticker. Its art is the Avery 5392
-- default too (decision, 30 Oct 2026), unpositioned: the 4×3 crop moves the
-- rule, so the renderer finds it again.
INSERT INTO public.default_badge_templates (theme, format, audience, artwork_path)
SELECT 'space', 'avery_5392', audience, artwork_path
FROM public.event_badge_templates
WHERE event_slug = 'colorado-space-design-challenge' AND format = 'avery_8395' AND audience IN ('everyone', 'mentors')
ON CONFLICT (theme, format, audience) DO NOTHING;
