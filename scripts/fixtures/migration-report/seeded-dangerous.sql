-- SEEDED DANGEROUS MIGRATION: a test fixture for scripts/migration-report.mjs.
-- Never applied: it lives outside supabase/migrations on purpose. Every red
-- flag the report knows must fire on it at least once
-- (scripts/migration-report.test.ts). Comments and strings that merely
-- mention DROP TABLE or TRUNCATE must not.

CREATE TABLE public.widgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_slug text NOT NULL,
  owner_id uuid REFERENCES auth.users (id),
  note text DEFAULT 'DROP TABLE is only text here; so is TRUNCATE'
);

ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;

/* A block comment: DELETE FROM public.widgets; GRANT ALL ON public.widgets TO anon; */

DROP TABLE public.old_widgets;

ALTER TABLE public.members DROP COLUMN legacy_phone;

TRUNCATE public.event_refunds;

DELETE FROM public.registrations;

UPDATE public.members SET age_bracket = NULL;

GRANT SELECT, INSERT ON public.widgets TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.widgets_wipe()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.widgets;
END;
$$;

ALTER TABLE public.participants DISABLE ROW LEVEL SECURITY;

ALTER TABLE public.registrations NO FORCE ROW LEVEL SECURITY;

CREATE POLICY "anyone reads widgets" ON public.widgets
  FOR SELECT TO anon USING (true);

CREATE POLICY "anyone uploads" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'agreements');

ALTER ROLE anon WITH BYPASSRLS;

ALTER POLICY "service role full access" ON public.members TO anon, authenticated;

DO $$
BEGIN
  EXECUTE format('DROP TABLE public.%I', 'old_events');
END
$$;
