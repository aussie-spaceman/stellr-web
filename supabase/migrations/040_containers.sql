-- Migration 040: container primitive (access-model Phase 4) — data backbone.
--
-- Generalises mentoring_cohorts into the one "container" primitive (a roster +
-- contents + lifecycle) that also covers coaching, Spaces and event/campaign
-- participation. Additive only — existing cohort/coaching code keeps working;
-- the Sessions→Containers admin UI and member-facing chat build on these columns.

-- 1. mentoring_cohorts → general container. ───────────────────────────────────
ALTER TABLE public.mentoring_cohorts
  ADD COLUMN IF NOT EXISTS container_type text NOT NULL DEFAULT 'mentoring'
    CHECK (container_type IN ('mentoring', 'coaching', 'space', 'event_participation', 'campaign_participation')),
  ADD COLUMN IF NOT EXISTS lifecycle text NOT NULL DEFAULT 'active'
    CHECK (lifecycle IN ('active', 'archived')),
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- 2. Roster relationship (decision D4 — participant / host / manager). ─────────
-- A Student Manager or mentor on the roster carries their relationship here
-- rather than it being inferred elsewhere.
ALTER TABLE public.cohort_members
  ADD COLUMN IF NOT EXISTS relationship text NOT NULL DEFAULT 'participant'
    CHECK (relationship IN ('participant', 'host', 'manager'));

-- 3. Chat opens to Spaces (decision D7 — real-time everywhere). ───────────────
ALTER TABLE public.chat_channels DROP CONSTRAINT IF EXISTS chat_channels_kind_check;
ALTER TABLE public.chat_channels
  ADD CONSTRAINT chat_channels_kind_check CHECK (kind IN ('cohort', 'coaching', 'space'));
ALTER TABLE public.chat_channels
  ADD COLUMN IF NOT EXISTS space_id uuid REFERENCES public.community_spaces(id) ON DELETE CASCADE;

-- One discussion channel per space.
CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_space_uniq
  ON public.chat_channels(space_id) WHERE kind = 'space';
