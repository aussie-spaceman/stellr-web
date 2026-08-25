-- 141 — Spaces for four more Challenge events, plus two data fixes.
--
-- 1. One private Space per event, mirroring how the Nevada and South Dakota
--    Challenge Spaces are configured: private, min_tier_rank 1, a single
--    'general' channel, and the five event roles auto-granted access
--    (participant, staff, student_manager, teacher, volunteer). Each is linked
--    to its event through community_space_sources so registrants inherit the
--    Space via syncObjectSpaceRoster.
--
--    Slugs match the published Sanity event slug exactly, so the Space slug and
--    its source object_ref agree. The two older Spaces use a '2027-' prefix that
--    matches nothing in Sanity — that mismatch is what caused fix 3 below, so it
--    is not repeated here.
--
-- 2. Theme fix: 'enviro' (green) was seeded on both existing Challenge Spaces,
--    including the Space Design ones. Space Design is 'space', Environmental
--    Design is 'enviro'. Cosmetic only — theme drives the card icon and dot.
--
-- 3. The Nevada Space pointed at event 'nevada-space-design-challenge-2027',
--    which does not exist in Sanity (the published slug has no year suffix), so
--    its event link was dead and no Nevada registrant could ever inherit it.
--    lib/container-sync.ts writes campaign_ref = the bare event slug, confirming
--    the un-suffixed form is the live convention. Note that
--    public.event_slug_inventory() — which backs `npm run audit:event-slugs` —
--    only scans columns literally named 'event_slug', so it cannot see
--    community_space_sources.object_ref and reported all-clear throughout.

-- ─── 1. New event Spaces ─────────────────────────────────────────────────────
DO $$
DECLARE
  ev record;
  s_id uuid;
  r text;
  event_roles text[] := ARRAY['participant', 'staff', 'student_manager', 'teacher', 'volunteer'];
BEGIN
  FOR ev IN
    SELECT * FROM (VALUES
      ('nebraska-space-design-challenge',          'Nebraska Space Design Challenge',          'space'),
      ('colorado-space-design-challenge',          'Colorado Space Design Challenge',          'space'),
      ('colorado-environmental-design-challenge',  'Colorado Environmental Design Challenge',  'enviro'),
      ('minnesota-environmental-design-challenge', 'Minnesota Environmental Design Challenge', 'enviro')
    ) AS t(slug, name, theme)
  LOOP
    INSERT INTO public.community_spaces
      (slug, name, access_type, theme, min_tier_rank, display_order, posting_policy, allow_member_uploads)
    VALUES (ev.slug, ev.name, 'private', ev.theme, 1, 0, 'all', true)
    ON CONFLICT (slug) DO NOTHING;

    SELECT id INTO s_id FROM public.community_spaces WHERE slug = ev.slug;

    INSERT INTO public.community_channels (space_id, slug, name, display_order)
    SELECT s_id, 'general', 'General', 0
    WHERE NOT EXISTS (
      SELECT 1 FROM public.community_channels WHERE space_id = s_id AND slug = 'general'
    );

    FOREACH r IN ARRAY event_roles LOOP
      INSERT INTO public.community_space_roles (space_id, role)
      SELECT s_id, r
      WHERE NOT EXISTS (
        SELECT 1 FROM public.community_space_roles WHERE space_id = s_id AND role = r
      );
    END LOOP;

    INSERT INTO public.community_space_sources (space_id, object_type, object_ref)
    SELECT s_id, 'event', ev.slug
    WHERE NOT EXISTS (
      SELECT 1 FROM public.community_space_sources
      WHERE space_id = s_id AND object_type = 'event' AND object_ref = ev.slug
    );
  END LOOP;
END $$;

-- ─── 2. Space Design Challenges are 'space', not 'enviro' ────────────────────
UPDATE public.community_spaces
SET theme = 'space'
WHERE slug IN ('2027-nevada-space-design-challenge', '2027-south-dakota-space-design-challenge');

-- ─── 3. Repoint the Nevada Space at its real event slug ──────────────────────
UPDATE public.community_space_sources
SET object_ref = 'nevada-space-design-challenge'
WHERE object_type = 'event'
  AND object_ref = 'nevada-space-design-challenge-2027';
