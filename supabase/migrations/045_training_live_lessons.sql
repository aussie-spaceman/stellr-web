-- Migration 045: live (video) lessons in Training (FR-COM-10 + JaaS).
--
-- Adds a 'live' lesson kind so a training_item can be an embedded video room
-- (JaaS/Jitsi) rather than a recorded video/document/link. The room is the same
-- provider seam used by Coaching/Mentoring sessions (lib/video-provider.ts); the
-- room name is derived from the item id (stellr-train-<itemId>), so no extra
-- provisioning row is needed.
--
-- After a live class ends, its cloud recording is offloaded from JaaS (24h TTL)
-- to private Supabase Storage by the recording webhook and shown back in the same
-- lesson as a replay — hence recording_path / recording_status mirror the columns
-- on public.sessions (migration 018).

-- Allow 'live' as a lesson content kind. The original CHECK (migration 017) is an
-- unnamed inline constraint → Postgres auto-names it training_items_content_kind_check.
ALTER TABLE public.training_items
  DROP CONSTRAINT IF EXISTS training_items_content_kind_check;

ALTER TABLE public.training_items
  ADD CONSTRAINT training_items_content_kind_check
  CHECK (content_kind IN ('video', 'document', 'google_doc', 'link', 'live'));

-- Recording offload target for live lessons (mirrors public.sessions).
ALTER TABLE public.training_items
  ADD COLUMN IF NOT EXISTS recording_path text;

ALTER TABLE public.training_items
  ADD COLUMN IF NOT EXISTS recording_status text NOT NULL DEFAULT 'none'
    CHECK (recording_status IN ('none', 'pending', 'available'));
