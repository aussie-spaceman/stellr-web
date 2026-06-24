-- Migration 072: Training portal follow-ups (post-deploy audit fixes).
--   (Renumbered from 069 — that slot was taken remotely by 069_spaces_channels;
--    this independent, unapplied follow-up moves after the remote head. No SQL change.)
--   #4 — add 'workshop' to the mentoring_cohorts.container_type taxonomy so
--        workshop Objects can exist and surface in the trainable-Object picker.
--   #5 — per-lesson attached resources (the design's "Attached resources" list
--        with + Add resource): a lesson can carry many files/links alongside its
--        primary content.

-- ─── #4. Workshop container type ─────────────────────────────────────────────
ALTER TABLE public.mentoring_cohorts
  DROP CONSTRAINT IF EXISTS mentoring_cohorts_container_type_check;
ALTER TABLE public.mentoring_cohorts
  ADD CONSTRAINT mentoring_cohorts_container_type_check
  CHECK (container_type IN (
    'mentoring', 'coaching', 'space', 'event_participation',
    'campaign_participation', 'training', 'workshop'
  ));

-- ─── #5. Per-lesson attached resources ───────────────────────────────────────
-- Files (private bucket) or links attached to a training lesson, shown beneath
-- the lesson's primary content in the member Course detail "Resources" list.
CREATE TABLE IF NOT EXISTS public.training_item_resources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id       uuid NOT NULL REFERENCES public.training_items(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('file', 'link')),
  title         text NOT NULL,
  storage_path  text,        -- set for kind = 'file' (private bucket)
  external_url  text,        -- set for kind = 'link'
  display_order integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS training_item_resources_item_idx
  ON public.training_item_resources(item_id, display_order);

ALTER TABLE public.training_item_resources ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access training_item_resources"
    ON public.training_item_resources FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
