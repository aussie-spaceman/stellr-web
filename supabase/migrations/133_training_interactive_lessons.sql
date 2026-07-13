-- Migration 133: interactive lessons in Training.
--
-- Adds an 'interactive' content_kind so a training_item can render a bespoke
-- React component (registered in lib/interactive-lessons-meta.ts) natively inside
-- the course player, instead of a video/document/link/live resource. The component
-- is named by interactive_key, which must match a key in the code registry —
-- unknown or empty keys render the player's 'unavailable' state.
--
-- No RLS change needed: items inherit module policies (migration 017).
--
-- Down path (documented, not automated): re-create the constraint without
-- 'interactive' after deleting/re-kinding any interactive rows, then
-- ALTER TABLE public.training_items DROP COLUMN interactive_key.

-- Allow 'interactive' as a lesson content kind. The CHECK was last re-created in
-- migration 045 (which itself replaced the unnamed inline constraint from 017).
ALTER TABLE public.training_items
  DROP CONSTRAINT IF EXISTS training_items_content_kind_check;

ALTER TABLE public.training_items
  ADD CONSTRAINT training_items_content_kind_check
  CHECK (content_kind IN ('video', 'document', 'google_doc', 'link', 'live', 'interactive'));

-- Which registered component this lesson renders (registry key, code-defined).
ALTER TABLE public.training_items
  ADD COLUMN IF NOT EXISTS interactive_key text;
