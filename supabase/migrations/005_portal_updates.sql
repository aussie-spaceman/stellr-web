-- Migration 005: Portal updates — event_participations, ethnicity/allergy option tables, missing membership tiers

-- ─── event_participations ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_participations (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id      uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  event_year     integer,
  event_location text,
  team_name      text,
  award          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_participations_member_id_idx
  ON public.event_participations(member_id);

ALTER TABLE public.event_participations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access event_participations"
    ON public.event_participations FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── ethnicity_options ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ethnicity_options (
  id   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL UNIQUE
);

ALTER TABLE public.ethnicity_options ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access ethnicity_options"
    ON public.ethnicity_options FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO public.ethnicity_options (name) VALUES
  ('Pacific Islander'),
  ('Hispanic'),
  ('White (Caucasian)'),
  ('Black'),
  ('Native American'),
  ('Asian'),
  ('Prefer Not To Say')
ON CONFLICT (name) DO NOTHING;

-- ─── member_ethnicities junction ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.member_ethnicities (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id           uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  ethnicity_option_id uuid NOT NULL REFERENCES public.ethnicity_options(id) ON DELETE CASCADE,
  UNIQUE(member_id, ethnicity_option_id)
);

ALTER TABLE public.member_ethnicities ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access member_ethnicities"
    ON public.member_ethnicities FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── allergy_options ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.allergy_options (
  id   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL UNIQUE
);

ALTER TABLE public.allergy_options ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access allergy_options"
    ON public.allergy_options FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO public.allergy_options (name) VALUES
  ('None'),
  ('Dairy / Lactose Free'),
  ('Gluten Free'),
  ('Vegetarian'),
  ('Vegan'),
  ('Other')
ON CONFLICT (name) DO NOTHING;

-- ─── member_allergies junction ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.member_allergies (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id         uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  allergy_option_id uuid NOT NULL REFERENCES public.allergy_options(id) ON DELETE CASCADE,
  UNIQUE(member_id, allergy_option_id)
);

ALTER TABLE public.member_allergies ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access member_allergies"
    ON public.member_allergies FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Missing membership tiers ─────────────────────────────────────────────
-- Advisor: college/mentor default free tier
INSERT INTO public.membership_tiers (name, is_free, age_bracket, sort_order)
SELECT 'Advisor', true, 'college', 9
WHERE NOT EXISTS (SELECT 1 FROM public.membership_tiers WHERE name = 'Advisor');

-- Donor: adult/mentor free tier
INSERT INTO public.membership_tiers (name, is_free, age_bracket, sort_order)
SELECT 'Donor', true, 'adult', 30
WHERE NOT EXISTS (SELECT 1 FROM public.membership_tiers WHERE name = 'Donor');

-- Expert: adult/mentor paid tier
INSERT INTO public.membership_tiers (name, is_free, age_bracket, sort_order)
SELECT 'Expert', false, 'adult', 31
WHERE NOT EXISTS (SELECT 1 FROM public.membership_tiers WHERE name = 'Expert');
