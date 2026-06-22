-- Migration 062: container convergence backfill (Phase P0) — ADDITIVE, NO BEHAVIOR CHANGE.
--
-- Migration 040 generalised mentoring_cohorts into a "container" primitive but the
-- event/campaign container types were never created in code — competitions still
-- resolve through registrations/participants/event_participations. This migration
-- backfills the container model for competitions so a later phase (P1) can resolve
-- access through ONE roster path:
--   • one event-level container per competition (campaign_ref = event_slug)
--   • one group sub-container per registration (parent = the event container)
--   • a cohort_members roster row per participant
--   • a generic container_contents table (generalises cohort_training_links)
--
-- NOTHING reads these structures yet. Resolution is unchanged until P1. Idempotent
-- (re-runnable): every insert is guarded by NOT EXISTS / ON CONFLICT.

-- 1. Container hierarchy + competition linkage on the container table. ─────────
ALTER TABLE public.mentoring_cohorts
  ADD COLUMN IF NOT EXISTS parent_container_id uuid REFERENCES public.mentoring_cohorts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS campaign_ref text,           -- event_slug this container delivers
  ADD COLUMN IF NOT EXISTS registration_id uuid REFERENCES public.registrations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS mentoring_cohorts_campaign_ref_idx ON public.mentoring_cohorts (campaign_ref);
CREATE INDEX IF NOT EXISTS mentoring_cohorts_parent_idx ON public.mentoring_cohorts (parent_container_id);
-- One event-level container per competition; one group sub-container per registration.
CREATE UNIQUE INDEX IF NOT EXISTS mentoring_cohorts_event_container_uniq
  ON public.mentoring_cohorts (campaign_ref)
  WHERE container_type = 'event_participation' AND parent_container_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mentoring_cohorts_group_container_uniq
  ON public.mentoring_cohorts (registration_id)
  WHERE registration_id IS NOT NULL;

-- 2. container_contents — generic "what's inside an object" (generalises
--    cohort_training_links to cover training, resources, recordings, etc.). ────
CREATE TABLE IF NOT EXISTS public.container_contents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id   uuid NOT NULL REFERENCES public.mentoring_cohorts(id) ON DELETE CASCADE,
  content_type   text NOT NULL CHECK (content_type IN
                   ('training_module', 'resource', 'recording', 'announcement', 'product')),
  content_ref    text NOT NULL,            -- module id / resource id / sanity id, as text
  is_mandatory   boolean NOT NULL DEFAULT false,
  due_at         timestamptz,
  min_membership smallint,                 -- optional tier-rank gate; null = inherit
  display_order  int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (container_id, content_type, content_ref)
);
CREATE INDEX IF NOT EXISTS container_contents_container_idx ON public.container_contents (container_id);
ALTER TABLE public.container_contents ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role all container_contents" ON public.container_contents
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Backfill: one event-level container per distinct competition. ────────────
INSERT INTO public.mentoring_cohorts (name, container_type, campaign_ref, lifecycle)
SELECT DISTINCT ON (r.event_slug)
       COALESCE(NULLIF(r.event_title, ''), r.event_slug),
       'event_participation', r.event_slug, 'active'
FROM public.registrations r
WHERE r.event_slug IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.mentoring_cohorts c
    WHERE c.container_type = 'event_participation'
      AND c.parent_container_id IS NULL
      AND c.campaign_ref = r.event_slug
  )
ORDER BY r.event_slug, r.created_at;

-- 4. Backfill: one group sub-container per registration, parented to its event. ─
INSERT INTO public.mentoring_cohorts
  (name, container_type, campaign_ref, registration_id, parent_container_id, lifecycle)
SELECT
  COALESCE(NULLIF(r.event_title, ''), r.event_slug) || ' — ' ||
    COALESCE(NULLIF(r.school_name, ''), NULLIF(r.teacher_email, ''), 'group'),
  'event_participation', r.event_slug, r.id,
  (SELECT c.id FROM public.mentoring_cohorts c
   WHERE c.container_type = 'event_participation'
     AND c.parent_container_id IS NULL
     AND c.campaign_ref = r.event_slug
   LIMIT 1),
  'active'
FROM public.registrations r
WHERE r.event_slug IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.mentoring_cohorts c WHERE c.registration_id = r.id
  );

-- 5. Backfill: roster rows from each registration's participants. ─────────────
INSERT INTO public.cohort_members (cohort_id, member_id, relationship, status)
SELECT sub.id, p.member_id, 'participant', 'active'
FROM public.participants p
JOIN public.mentoring_cohorts sub ON sub.registration_id = p.registration_id
WHERE p.member_id IS NOT NULL
ON CONFLICT (cohort_id, member_id) DO NOTHING;

-- 6. Migrate cohort training links into the generic contents table. ──────────
INSERT INTO public.container_contents
  (container_id, content_type, content_ref, is_mandatory, due_at, display_order)
SELECT l.cohort_id, 'training_module', l.module_id::text, l.is_mandatory, l.due_at, l.display_order
FROM public.cohort_training_links l
ON CONFLICT (container_id, content_type, content_ref) DO NOTHING;
