-- Migration 043: content tier on group registrations (access-model Phase 2 wiring).
--
-- The competition content tier is purchased once per group registration by the
-- nominated adult / Student Manager (decision D3) and cascades to every enrolled
-- participant's event_participations.content_tier (see lib/event-participation-sync.ts
-- applyCampaignContentTier). NULL = a plain registration with no content tier.
ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS content_tier text
    CHECK (content_tier IN ('core', 'baseline', 'advanced', 'premium'));
