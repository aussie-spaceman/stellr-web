-- Migration 066: drop deprecated content_tier columns (access-convergence item #6).
--
-- The content_tier axis (migrations 038 + 043) was never implemented in the read
-- path. The unified container model owns content assignment going forward.
-- Zero active code references confirmed before this migration was written.

-- content_entitlements ────────────────────────────────────────────────────────
-- Remove any rows keyed on content_tier before dropping the column.
DELETE FROM public.content_entitlements WHERE content_tier IS NOT NULL;

-- The cross-column "exactly one subject" constraint must go first.
ALTER TABLE public.content_entitlements
  DROP CONSTRAINT IF EXISTS content_entitlements_one_subject;

DROP INDEX IF EXISTS content_entitlements_content_tier_uniq;
ALTER TABLE public.content_entitlements DROP COLUMN IF EXISTS content_tier;

-- tier_id is now always the subject; restore NOT NULL (was dropped in migration 038).
ALTER TABLE public.content_entitlements ALTER COLUMN tier_id SET NOT NULL;

-- event_participations ────────────────────────────────────────────────────────
ALTER TABLE public.event_participations DROP COLUMN IF EXISTS content_tier;

-- registrations ───────────────────────────────────────────────────────────────
ALTER TABLE public.registrations DROP COLUMN IF EXISTS content_tier;
