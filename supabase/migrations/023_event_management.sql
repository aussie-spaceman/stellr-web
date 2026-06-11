-- Migration 023: Event Management foundation (PRD 6.7)
-- Event settings, Companies, check-in fields, and per-event Event Manager assignments.

-- ─── event_settings ────────────────────────────────────────────────────────
-- One row per event (keyed by Sanity slug). Sanity stays the source of truth
-- for event content; this holds operational settings the portal owns.
CREATE TABLE IF NOT EXISTS public.event_settings (
  event_slug                text PRIMARY KEY,
  company_count             integer CHECK (company_count BETWEEN 1 AND 10),
  check_in_token            text UNIQUE,
  check_in_open             boolean NOT NULL DEFAULT false,
  badge_artwork_path        text,
  certificate_artwork_path  text,
  certificate_format        text NOT NULL DEFAULT 'us_letter'
                            CHECK (certificate_format IN ('us_letter', 'a4')),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.event_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access event_settings"
    ON public.event_settings FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER event_settings_updated_at
    BEFORE UPDATE ON public.event_settings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── event_companies ───────────────────────────────────────────────────────
-- Companies (teams) within an event. Number 1-10; name is optional.
CREATE TABLE IF NOT EXISTS public.event_companies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_slug  text NOT NULL,
  number      integer NOT NULL CHECK (number BETWEEN 1 AND 10),
  name        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_slug, number)
);

CREATE INDEX IF NOT EXISTS event_companies_event_slug_idx
  ON public.event_companies (event_slug);

ALTER TABLE public.event_companies ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access event_companies"
    ON public.event_companies FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── participants: company assignment + check-in ───────────────────────────
ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS company_id      uuid REFERENCES public.event_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checked_in_at   timestamptz,
  ADD COLUMN IF NOT EXISTS check_in_method text CHECK (check_in_method IN ('qr', 'manual', 'virtual'));

CREATE INDEX IF NOT EXISTS participants_company_id_idx
  ON public.participants (company_id);

-- ─── event_manager_assignments ─────────────────────────────────────────────
-- Event Managers (Clerk role=event_manager) must be assigned to an event
-- before they can manage it. Admins implicitly manage all events.
CREATE TABLE IF NOT EXISTS public.event_manager_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id  text NOT NULL,
  event_slug     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clerk_user_id, event_slug)
);

CREATE INDEX IF NOT EXISTS event_manager_assignments_user_idx
  ON public.event_manager_assignments (clerk_user_id);

CREATE INDEX IF NOT EXISTS event_manager_assignments_event_idx
  ON public.event_manager_assignments (event_slug);

ALTER TABLE public.event_manager_assignments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access event_manager_assignments"
    ON public.event_manager_assignments FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
