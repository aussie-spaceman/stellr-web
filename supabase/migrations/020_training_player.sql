-- Migration 020: Training lesson player + drip release (FR-COM-10).
--
-- Builds on migration 019 (course types + sections + per-lesson status):
--   * training_enrollments — one row per member per module, recording when the
--     member first opened the course. This is the reference date that 'structured'
--     courses drip their sections from (see training_sections.drip_days). It also
--     gives us a clean enrolled-member count for reporting later.
--   * training_items.body — optional rich lesson notes shown beneath the featured
--     media in the lesson player (Circle's lesson body).
--
-- Drip release is enforced in the server layer (lib/training.ts), not in RLS:
--   self_paced → all sections available immediately
--   structured → section available enrolled_at + drip_days days from now
--   scheduled  → section available module.start_date + drip_days days from now
--
-- Conventions follow migrations 017/018/019: gen_random_uuid() PKs, RLS enabled
-- with a single service-role policy (all gating in the server layer).

-- ─── training_enrollments ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.training_enrollments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  module_id   uuid NOT NULL REFERENCES public.training_modules(id) ON DELETE CASCADE,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, module_id)
);

CREATE INDEX IF NOT EXISTS training_enrollments_member_idx
  ON public.training_enrollments(member_id);

ALTER TABLE public.training_enrollments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access training_enrollments"
    ON public.training_enrollments FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── training_items.body ─────────────────────────────────────────────────────
ALTER TABLE public.training_items
  ADD COLUMN IF NOT EXISTS body text;
