-- Phase MS — extend the membership grant-rules engine so Membership Studio can
-- own two new admin-editable rules:
--   1. A student who registers for a competition → Pathfinder (12mo).         [self grant]
--   2. An educator who buys Innovator/Trailblazer → the students they          [fan-out grant]
--      registered get Pathfinder for the duration of the educator's membership.
--
-- New trigger types:  'competition_registration', 'tier_purchased'
-- New duration kind:  'match_source'  (expiry copied from the triggering membership)
-- New rule column:    grant_target ∈ ('self','registered_students')
-- conditions gains an optional 'source_tier_ids' array (tier_purchased only):
--   the membership tiers whose purchase fires the rule.

-- 1. Trigger types — re-create the CHECK with the two new triggers added. ──────
ALTER TABLE public.tier_grant_rules DROP CONSTRAINT IF EXISTS tier_grant_rules_trigger_type_check;
ALTER TABLE public.tier_grant_rules
  ADD CONSTRAINT tier_grant_rules_trigger_type_check CHECK (trigger_type IN (
    'signup', 'event_attendance', 'event_award', 'mentor_at_event',
    'subscribe_website', 'graduation', 'manual', 'campaign_enrollment',
    'competition_registration', 'tier_purchased'));

-- 2. Duration kinds — add 'match_source'. ────────────────────────────────────
ALTER TABLE public.tier_grant_rules DROP CONSTRAINT IF EXISTS tier_grant_rules_duration_kind_check;
ALTER TABLE public.tier_grant_rules
  ADD CONSTRAINT tier_grant_rules_duration_kind_check CHECK (duration_kind IN (
    'months', 'until_grad_july1', 'lifetime', 'match_source'));

-- 3. Who receives the grant. 'self' = the triggering member (today's only
--    behaviour); 'registered_students' = the students the triggering educator
--    registered for competitions (registrations.teacher_member_id → participants).
ALTER TABLE public.tier_grant_rules
  ADD COLUMN IF NOT EXISTS grant_target text NOT NULL DEFAULT 'self'
    CHECK (grant_target IN ('self', 'registered_students'));

-- 4. Trailblazer — top educator tier ($1,000/yr, sales-led via /contact, so no
--    Stripe price here). A real membership_tiers row so it's admin-assignable and
--    can drive the cohort-upgrade rule below. Idempotent.
INSERT INTO public.membership_tiers (name, is_free, age_bracket, sort_order)
SELECT 'Trailblazer', false, 'adult', 23
WHERE NOT EXISTS (SELECT 1 FROM public.membership_tiers WHERE name = 'Trailblazer');

UPDATE public.membership_tiers
  SET description = COALESCE(description, 'Top educator tier — everything in Innovator plus bi-weekly mentoring calls, CPD credits, student awards. Sales-led (contact us).'),
      badge_color = COALESCE(badge_color, 'amber'),
      default_grant_months = COALESCE(default_grant_months, 12),
      eligible_roles = COALESCE(eligible_roles, ARRAY['teacher']::text[])
  WHERE name = 'Trailblazer';

-- 5. Seed the two rules (idempotent by name). ────────────────────────────────
DO $$
DECLARE
  t_pathfinder uuid := (SELECT id FROM public.membership_tiers WHERE name = 'Pathfinder'  LIMIT 1);
  t_innovator  uuid := (SELECT id FROM public.membership_tiers WHERE name = 'Innovator'   LIMIT 1);
  t_trailblzr  uuid := (SELECT id FROM public.membership_tiers WHERE name = 'Trailblazer' LIMIT 1);
BEGIN
  -- 5a. Student registers for a competition → Pathfinder (12 months), to self.
  IF t_pathfinder IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tier_grant_rules WHERE name = 'Competition registration → Pathfinder (12mo)'
  ) THEN
    INSERT INTO public.tier_grant_rules
      (name, trigger_type, conditions, grant_tier_id, duration_kind, duration_months, grant_target, replaces_free, priority)
    VALUES
      ('Competition registration → Pathfinder (12mo)', 'competition_registration',
       '{"event_role":"school_student"}'::jsonb, t_pathfinder, 'months', 12, 'self', false, 10);
  END IF;

  -- 5b. Educator buys Innovator/Trailblazer → registered students get Pathfinder,
  --     expiring with the educator's membership (match_source).
  IF t_pathfinder IS NOT NULL AND (t_innovator IS NOT NULL OR t_trailblzr IS NOT NULL) AND NOT EXISTS (
    SELECT 1 FROM public.tier_grant_rules WHERE name = 'Educator tier → registered students get Pathfinder'
  ) THEN
    INSERT INTO public.tier_grant_rules
      (name, trigger_type, conditions, grant_tier_id, duration_kind, grant_target, replaces_free, priority)
    VALUES
      ('Educator tier → registered students get Pathfinder', 'tier_purchased',
       jsonb_build_object('source_tier_ids',
         (SELECT jsonb_agg(id) FROM public.membership_tiers WHERE name IN ('Innovator', 'Trailblazer'))),
       t_pathfinder, 'match_source', 'registered_students', false, 20);
  END IF;
END $$;
