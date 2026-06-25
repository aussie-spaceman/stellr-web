-- 086_backfill_space_resource_contents.sql
-- Fix: files uploaded to a Space (chat attach / admin upload) weren't appearing in
-- the global Resources catalogue. The catalogue resolves via container_contents,
-- but Space-upload paths only inserted community_resources (with space_id) and
-- never created the container_contents attachment. Migration 065 backfilled the
-- rows that existed then; this catches everything uploaded since, and the upload
-- routes now create the row going forward (lib/container-sync.attachSpaceResource).
--
-- Idempotent (NOT EXISTS guards).

-- 1. One space container per Space (container_type='space', campaign_ref = slug).
INSERT INTO public.mentoring_cohorts (name, container_type, campaign_ref, lifecycle)
SELECT s.name, 'space', s.slug, 'active'
FROM public.community_spaces s
WHERE NOT EXISTS (
  SELECT 1 FROM public.mentoring_cohorts c
  WHERE c.container_type = 'space' AND c.campaign_ref = s.slug
);

-- 2. A container_contents row for every space-attached resource missing one.
INSERT INTO public.container_contents (container_id, content_type, content_ref)
SELECT c.id, 'resource', r.id::text
FROM public.community_resources r
JOIN public.community_spaces s   ON s.id = r.space_id
JOIN public.mentoring_cohorts c  ON c.container_type = 'space' AND c.campaign_ref = s.slug
WHERE r.space_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.container_contents cc
    WHERE cc.container_id = c.id
      AND cc.content_type = 'resource'
      AND cc.content_ref  = r.id::text
  );
