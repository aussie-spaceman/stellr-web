-- Migration 041: prerequisite + persistence gates (access-model Phase 5).
--
-- Two gates that MODIFY a granted access decision (they never grant on their own):
--   * prerequisites — lock a target until its predecessor is complete
--   * persistence   — when a container archives, keep some items open in perpetuity
--                     and re-gate the rest (decision D1: re-gate is the default)

-- 1. content_prerequisites — "to access TARGET, first complete REQUIRES". ──────
-- Decision D6: completion is a member-level fact, so a met prerequisite unlocks
-- the dependent target everywhere (global, not container-scoped).
CREATE TABLE IF NOT EXISTS public.content_prerequisites (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type          text NOT NULL CHECK (target_type IN (
                         'space', 'resource', 'training_module',
                         'event_material', 'campaign_material', 'mentoring', 'coaching')),
  target_ref           text NOT NULL,
  requires_target_type text NOT NULL CHECK (requires_target_type IN ('training_module', 'resource')),
  requires_target_ref  text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_type, target_ref, requires_target_type, requires_target_ref)
);
CREATE INDEX IF NOT EXISTS content_prerequisites_target_idx
  ON public.content_prerequisites(target_type, target_ref);

ALTER TABLE public.content_prerequisites ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access content_prerequisites"
    ON public.content_prerequisites FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. content_persistence — per-item policy for an ARCHIVED container. ──────────
-- Decision D1: absence of a row = re_gate (the safe default). A 'keep_open' row
-- means past members retain access in perpetuity even after the container archives.
CREATE TABLE IF NOT EXISTS public.content_persistence (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type  text NOT NULL,
  target_ref   text NOT NULL,
  policy       text NOT NULL DEFAULT 're_gate' CHECK (policy IN ('keep_open', 're_gate')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_type, target_ref)
);

ALTER TABLE public.content_persistence ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access content_persistence"
    ON public.content_persistence FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
