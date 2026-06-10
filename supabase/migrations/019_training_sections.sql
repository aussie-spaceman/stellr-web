-- Migration 019: Training course types + sections + per-lesson status (FR-COM-10).
--
-- Brings the training module in line with a Circle-style course experience:
--   * course_type on a module — how content is paced/released:
--       'self_paced' → all content available on enrollment (default, legacy behaviour)
--       'structured' → sections dripped relative to a member's enrollment date
--       'scheduled'  → sections dripped relative to a fixed course start date
--   * training_sections — named, ordered groups that lessons belong to, so the
--     learner sees a curriculum ("3 sections · 4 lessons") instead of a flat list.
--   * training_items.section_id — optional section a lesson lives in (NULL = the
--     module's default/ungrouped lessons, so existing rows keep working).
--   * training_items.status — per-lesson Draft/Published, mirroring Circle. Only
--     'published' lessons are shown to members; drafts are author-only.
--
-- Conventions follow migrations 012/017/018: gen_random_uuid() PKs, RLS enabled
-- with a single service-role policy (all gating lives in the server layer).

-- ─── training_modules.course_type ───────────────────────────────────────────
ALTER TABLE public.training_modules
  ADD COLUMN IF NOT EXISTS course_type text NOT NULL DEFAULT 'self_paced'
    CHECK (course_type IN ('self_paced', 'structured', 'scheduled'));

-- Fixed start date for 'scheduled' courses (NULL for self_paced/structured).
ALTER TABLE public.training_modules
  ADD COLUMN IF NOT EXISTS start_date timestamptz;

-- ─── training_sections ───────────────────────────────────────────────────────
-- Ordered groups of lessons within a module. For 'structured'/'scheduled'
-- courses, drip_days releases the section that many days after the reference
-- date (enrollment date or start_date); 0 = immediately available.
CREATE TABLE IF NOT EXISTS public.training_sections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id     uuid NOT NULL REFERENCES public.training_modules(id) ON DELETE CASCADE,
  title         text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  drip_days     integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS training_sections_module_idx
  ON public.training_sections(module_id, display_order);

ALTER TABLE public.training_sections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access training_sections"
    ON public.training_sections FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── training_items: section_id + status ─────────────────────────────────────
ALTER TABLE public.training_items
  ADD COLUMN IF NOT EXISTS section_id uuid
    REFERENCES public.training_sections(id) ON DELETE SET NULL;

ALTER TABLE public.training_items
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft', 'published'));

CREATE INDEX IF NOT EXISTS training_items_section_idx
  ON public.training_items(section_id, display_order);
