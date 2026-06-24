-- 080_grant_rules_credits.sql
-- Rec 2 of the Workshops & Cohorts access plan (docs/WORKSHOP-COHORT-ACCESS-PLAN.md).
--
-- Extends the grant-rules engine (tier_grant_rules, 025/061) so a rule can grant a
-- fixed QUANTITY of wallet credits (cohort or workshop) instead of only a tier.
-- This wires the "earn N workshops/cohort seats by attending an event (or buying a
-- tier)" path into the shared credit wallet (lib/credits.ts).
--
--   grant_kind        'tier' (existing behaviour) | 'credits'
--   grant_credit_type 'mentoring' (cohort) | 'workshop'   — required when kind='credits'
--   grant_quantity    integer                            — required when kind='credits'
--
-- Credit-granting rules leave grant_tier_id NULL, so its NOT NULL is relaxed.

-- ─── 1. New columns ─────────────────────────────────────────────────────────
ALTER TABLE public.tier_grant_rules
  ADD COLUMN IF NOT EXISTS grant_kind text NOT NULL DEFAULT 'tier'
    CHECK (grant_kind IN ('tier', 'credits')),
  ADD COLUMN IF NOT EXISTS grant_credit_type text
    CHECK (grant_credit_type IN ('mentoring', 'workshop')),
  ADD COLUMN IF NOT EXISTS grant_quantity integer;

-- ─── 2. Relax grant_tier_id NOT NULL (credit rules carry no tier) ───────────
ALTER TABLE public.tier_grant_rules ALTER COLUMN grant_tier_id DROP NOT NULL;

-- ─── 3. Integrity: a credit rule must name a credit type + positive quantity ─
ALTER TABLE public.tier_grant_rules DROP CONSTRAINT IF EXISTS tier_grant_rules_grant_shape_check;
ALTER TABLE public.tier_grant_rules
  ADD CONSTRAINT tier_grant_rules_grant_shape_check CHECK (
    (grant_kind = 'tier'    AND grant_tier_id IS NOT NULL)
    OR
    (grant_kind = 'credits' AND grant_credit_type IS NOT NULL AND grant_quantity IS NOT NULL AND grant_quantity > 0)
  );

-- ─── 4. Example rule (INACTIVE — admin enables in Membership Studio) ─────────
-- "Attend an event → 1 workshop credit", to self, for any school student.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tier_grant_rules WHERE name = 'Event attendance → 1 workshop credit') THEN
    INSERT INTO public.tier_grant_rules
      (name, trigger_type, conditions, grant_kind, grant_credit_type, grant_quantity,
       grant_target, duration_kind, replaces_free, priority, is_active)
    VALUES
      ('Event attendance → 1 workshop credit', 'event_attendance',
       '{"event_role":"school_student"}'::jsonb, 'credits', 'workshop', 1,
       'self', 'lifetime', false, 10, false);
  END IF;
END $$;
