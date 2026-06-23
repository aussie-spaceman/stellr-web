-- Migration 065: Spaces + Training as first-class containers + resource backfill.
--
-- Access-convergence plan items #4 and #5:
--   #4  One mentoring_cohorts container row per community_space (container_type='space',
--       campaign_ref=slug) and per training_module (container_type='training',
--       campaign_ref=id::text). Runtime helpers in lib/container-sync.ts keep
--       new rows in sync as spaces/modules are created.
--   #5  Backfill community_resources into container_contents (content_type='resource',
--       content_ref=resource uuid). Additive — member read paths unchanged for now.
--
-- All statements are idempotent (NOT EXISTS / ON CONFLICT DO NOTHING guards).

-- 1. Extend container_type CHECK to include 'training'. ───────────────────────
-- The inline CHECK on ADD COLUMN is auto-named {table}_{column}_check; find it
-- dynamically so we're not brittle against Postgres naming variations.
DO $$
DECLARE
  cname text;
BEGIN
  SELECT constraint_name INTO cname
  FROM information_schema.table_constraints
  WHERE table_schema = 'public'
    AND table_name   = 'mentoring_cohorts'
    AND constraint_type = 'CHECK'
    AND constraint_name LIKE '%container_type%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.mentoring_cohorts DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE public.mentoring_cohorts
  ADD CONSTRAINT mentoring_cohorts_container_type_check
  CHECK (container_type IN (
    'mentoring', 'coaching', 'space', 'event_participation',
    'campaign_participation', 'training'
  ));

-- 2. Unique indexes (one container per space slug / module id). ───────────────
CREATE UNIQUE INDEX IF NOT EXISTS mentoring_cohorts_space_container_uniq
  ON public.mentoring_cohorts (campaign_ref)
  WHERE container_type = 'space';

CREATE UNIQUE INDEX IF NOT EXISTS mentoring_cohorts_training_container_uniq
  ON public.mentoring_cohorts (campaign_ref)
  WHERE container_type = 'training';

-- 3. Backfill: one container per community_space. ────────────────────────────
INSERT INTO public.mentoring_cohorts (name, container_type, campaign_ref, lifecycle)
SELECT s.name, 'space', s.slug, 'active'
FROM public.community_spaces s
WHERE NOT EXISTS (
  SELECT 1 FROM public.mentoring_cohorts mc
  WHERE mc.container_type = 'space' AND mc.campaign_ref = s.slug
)
ON CONFLICT DO NOTHING;

-- 4. Backfill: one container per training_module. ────────────────────────────
INSERT INTO public.mentoring_cohorts (name, container_type, campaign_ref, lifecycle)
SELECT m.title, 'training', m.id::text, 'active'
FROM public.training_modules m
WHERE NOT EXISTS (
  SELECT 1 FROM public.mentoring_cohorts mc
  WHERE mc.container_type = 'training' AND mc.campaign_ref = m.id::text
)
ON CONFLICT DO NOTHING;

-- 5. Backfill: community_resources (those linked to a space) → container_contents. ─
-- The space container row is already created above, so the JOIN resolves immediately.
INSERT INTO public.container_contents (container_id, content_type, content_ref, is_mandatory)
SELECT mc.id, 'resource', r.id::text, false
FROM public.community_resources r
JOIN public.community_spaces s  ON s.id  = r.space_id
JOIN public.mentoring_cohorts mc ON mc.container_type = 'space' AND mc.campaign_ref = s.slug
WHERE r.space_id IS NOT NULL
ON CONFLICT (container_id, content_type, content_ref) DO NOTHING;
