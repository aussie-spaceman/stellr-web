-- Migration 038: content-tier axis (PRD competition content plan — access-model Phase 2)
--
-- Adds a second entitlement SUBJECT: the per-campaign Content Tier
-- (core < baseline < advanced < premium, cumulative), orthogonal to the
-- persistent membership tier. A content_entitlements row now carries EITHER a
-- membership tier_id OR a content_tier — never both.
--
-- See lib/community.ts (read path) and lib/membership-grants.ts (write path).

-- 1. content_entitlements: allow content-tier-keyed rows. ─────────────────────
ALTER TABLE public.content_entitlements ALTER COLUMN tier_id DROP NOT NULL;

ALTER TABLE public.content_entitlements
  ADD COLUMN IF NOT EXISTS content_tier text
    CHECK (content_tier IN ('core', 'baseline', 'advanced', 'premium'));

-- Exactly one subject per row (membership tier XOR content tier).
ALTER TABLE public.content_entitlements DROP CONSTRAINT IF EXISTS content_entitlements_one_subject;
ALTER TABLE public.content_entitlements
  ADD CONSTRAINT content_entitlements_one_subject
  CHECK (num_nonnulls(tier_id, content_tier) = 1);

-- Uniqueness for content-tier rows (membership-tier rows keep their existing
-- UNIQUE; NULL tier_id rows are distinct there, so a partial index covers these).
CREATE UNIQUE INDEX IF NOT EXISTS content_entitlements_content_tier_uniq
  ON public.content_entitlements (content_tier, target_type, target_ref, access_level)
  WHERE content_tier IS NOT NULL;

-- 2. event_participations: the content tier this participant is enrolled at. ───
-- Set at enrollment, cascaded from the group registration's purchase (decision
-- D3: buyer = nominated adult / Student Manager who owns the registration).
-- NULL = a plain event participation with no content tier.
ALTER TABLE public.event_participations
  ADD COLUMN IF NOT EXISTS content_tier text
    CHECK (content_tier IN ('core', 'baseline', 'advanced', 'premium'));

-- 3. tier_grant_rules: recognise the campaign_enrollment trigger (write path). ─
ALTER TABLE public.tier_grant_rules DROP CONSTRAINT IF EXISTS tier_grant_rules_trigger_type_check;
ALTER TABLE public.tier_grant_rules
  ADD CONSTRAINT tier_grant_rules_trigger_type_check
  CHECK (trigger_type IN (
    'signup', 'event_attendance', 'event_award',
    'mentor_at_event', 'subscribe_website', 'graduation', 'manual',
    'campaign_enrollment'));

-- 4. Seed: Premium enrollment → Pathfinder for 12 months (decision D2). ────────
-- Baseline/Advanced grant content access only (no membership change), so only
-- Premium needs a grant rule. The caller fires this trigger when content_tier =
-- 'premium'; a Student Manager matches student-scoped rules via matchesConditions.
DO $$
DECLARE
  t_pathfinder uuid := (SELECT id FROM public.membership_tiers WHERE name = 'Pathfinder' LIMIT 1);
BEGIN
  IF t_pathfinder IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tier_grant_rules WHERE name = 'Premium enrollment → Pathfinder (12mo)'
  ) THEN
    INSERT INTO public.tier_grant_rules
      (name, trigger_type, conditions, grant_tier_id, duration_kind, duration_months, replaces_free, priority)
    VALUES
      ('Premium enrollment → Pathfinder (12mo)', 'campaign_enrollment', '{}'::jsonb,
       t_pathfinder, 'months', 12, false, 50);
  END IF;
END $$;
