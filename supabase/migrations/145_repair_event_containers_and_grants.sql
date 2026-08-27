-- 145 — One-off repair: repoint the stale event containers, and stop event
--       Spaces granting access by org-wide role.
--
-- Depends on 144 (which is what makes part 1's damage visible to the audit).
--
-- ─── PART 1: the containers the slug rename missed ───────────────────────────
--
-- When the year suffixes were pulled from the Sanity event slugs, migration
-- 138's rename_event_slug() repaired every column named `event_slug` but could
-- not see mentoring_cohorts.campaign_ref. So `registrations` and
-- `event_participations` moved to the new slug while the event CONTAINERS —
-- which hold the actual rosters — stayed on the old one.
--
-- That break sits in the middle of the Space inheritance chain
-- (space → source(slug) → container(campaign_ref) → cohort_members), so
-- objectActiveMemberIds() resolved to nothing and no registrant could inherit
-- their event's Space. Every event Space in prod has an empty roster because of
-- this.
--
-- 16 rows across 5 slugs, verified in prod 27 Aug 2026:
--
--   space-design-campaign-fall-2027               → space-design-campaign-fall
--   nevada-space-design-challenge-2026            → nevada-space-design-challenge
--   nevada-space-design-challenge-2027            → nevada-space-design-challenge
--   minnesota-environmental-design-challenge-2026 → minnesota-environmental-design-challenge
--   environmental-design-campaign                 → environmental-design-campaign-fall
--
-- THE COLLISION. The two Nevada refs collapse onto one slug, and
-- `mentoring_cohorts_event_container_uniq` (unique on campaign_ref where
-- container_type = 'event_participation' and parent_container_id is null)
-- permits only ONE root per event. A straight UPDATE therefore aborts with a
-- duplicate-key error partway through the repair. The roots have to be MERGED
-- first, and only then repointed — which is the order below.
--
-- The merge keeps the oldest root, re-parents the losing roots' group children
-- onto it, moves any roster rows off the losers, and deletes them. The delete is
-- guarded on the loser having no members and no remaining children, so a re-run
-- or an unexpected row can never take live data with it. (Nothing is at stake
-- in prod today: all 10 Nevada containers hold 0 members and every group belongs
-- to a withdrawn registration. The guard is for the re-run case.)
--
-- ─── PART 2: event Spaces must not grant by org-wide role ────────────────────
--
-- Migration 141 gave each event Space the five event roles (participant, staff,
-- student_manager, teacher, volunteer) as auto-grants, mirroring the two Spaces
-- that predated it. But community_space_roles matches a member's GLOBAL role —
-- resolveSpaceAccess() reads getGlobalRoleNames(), which excludes object-scoped
-- roles — so "teacher" means every teacher in the organisation, not the teachers
-- at that event. Any member holding a global 'teacher' row could enter EVERY
-- event's Space without registering for any of them; 7 members could, as of
-- 27 Aug 2026.
--
-- Event access comes from the event: the source link plus the container roster.
-- These grants are removed here, and lib/spaces.ts now refuses to apply tier or
-- role grants to an event-linked Space, so a stray checkbox cannot restore them.

-- ─── Part 1: merge colliding roots, then repoint ─────────────────────────────

DO $$
DECLARE
  m record;
  keeper uuid;
  moved bigint;
  removed bigint;
BEGIN
  FOR m IN
    SELECT new_slug, array_agg(old_slug) AS old_slugs
      FROM (VALUES
        ('space-design-campaign-fall-2027',               'space-design-campaign-fall'),
        ('nevada-space-design-challenge-2026',            'nevada-space-design-challenge'),
        ('nevada-space-design-challenge-2027',            'nevada-space-design-challenge'),
        ('minnesota-environmental-design-challenge-2026', 'minnesota-environmental-design-challenge'),
        ('environmental-design-campaign',                 'environmental-design-campaign-fall')
      ) AS t(old_slug, new_slug)
     GROUP BY new_slug
  LOOP
    -- The surviving root: the oldest among the roots on any of the old slugs
    -- AND any root already sitting on the destination slug.
    SELECT id INTO keeper
      FROM public.mentoring_cohorts
     WHERE container_type = 'event_participation'
       AND parent_container_id IS NULL
       AND (campaign_ref = ANY(m.old_slugs) OR campaign_ref = m.new_slug)
     ORDER BY created_at NULLS LAST, id
     LIMIT 1;

    IF keeper IS NULL THEN
      RAISE NOTICE 'no container to repair for %', m.new_slug;
      CONTINUE;
    END IF;

    -- Re-parent the losing roots' group children onto the keeper.
    UPDATE public.mentoring_cohorts child
       SET parent_container_id = keeper
     WHERE child.parent_container_id IN (
             SELECT id FROM public.mentoring_cohorts
              WHERE container_type = 'event_participation'
                AND parent_container_id IS NULL
                AND (campaign_ref = ANY(m.old_slugs) OR campaign_ref = m.new_slug)
                AND id <> keeper
           );
    GET DIAGNOSTICS moved = ROW_COUNT;

    -- Move roster rows off the losing roots, so the delete cannot strand anyone.
    -- Skipped where the member is already on the keeper (cohort_members is
    -- unique on (cohort_id, member_id)).
    UPDATE public.cohort_members cm
       SET cohort_id = keeper
     WHERE cm.cohort_id IN (
             SELECT id FROM public.mentoring_cohorts
              WHERE container_type = 'event_participation'
                AND parent_container_id IS NULL
                AND (campaign_ref = ANY(m.old_slugs) OR campaign_ref = m.new_slug)
                AND id <> keeper
           )
       AND NOT EXISTS (
             SELECT 1 FROM public.cohort_members k
              WHERE k.cohort_id = keeper AND k.member_id = cm.member_id
           );

    -- Anything left on a loser is a duplicate of a keeper row; drop it so the
    -- root can be deleted.
    DELETE FROM public.cohort_members cm
     WHERE cm.cohort_id IN (
             SELECT id FROM public.mentoring_cohorts
              WHERE container_type = 'event_participation'
                AND parent_container_id IS NULL
                AND (campaign_ref = ANY(m.old_slugs) OR campaign_ref = m.new_slug)
                AND id <> keeper
           );

    -- Delete the emptied losing roots. Guarded: no members, no children.
    DELETE FROM public.mentoring_cohorts losing
     WHERE losing.container_type = 'event_participation'
       AND losing.parent_container_id IS NULL
       AND (losing.campaign_ref = ANY(m.old_slugs) OR losing.campaign_ref = m.new_slug)
       AND losing.id <> keeper
       AND NOT EXISTS (SELECT 1 FROM public.cohort_members cm WHERE cm.cohort_id = losing.id)
       AND NOT EXISTS (SELECT 1 FROM public.mentoring_cohorts c WHERE c.parent_container_id = losing.id);
    GET DIAGNOSTICS removed = ROW_COUNT;

    -- Only now is the unique index free for the repoint.
    UPDATE public.mentoring_cohorts
       SET campaign_ref = m.new_slug
     WHERE container_type = 'event_participation'
       AND campaign_ref = ANY(m.old_slugs);

    RAISE NOTICE 'repaired %: keeper %, % child container(s) re-parented, % duplicate root(s) removed',
      m.new_slug, keeper, moved, removed;
  END LOOP;
END $$;

-- ─── Part 2: drop the role auto-grants from every event-linked Space ─────────

DELETE FROM public.community_space_roles r
 WHERE EXISTS (
   SELECT 1 FROM public.community_space_sources s
    WHERE s.space_id = r.space_id
      AND s.object_type = 'event'
 );
