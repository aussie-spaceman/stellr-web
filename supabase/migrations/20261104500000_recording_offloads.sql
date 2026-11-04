-- Recording offloads (4 Nov 2026).
--
-- A 5-minute lesson recording was lost because the only copy of JaaS's download
-- link lived in the webhook request. When the upload to storage failed, the row
-- went back to 'none' with nothing to retry from, and JaaS deletes the file 24
-- hours later. Nothing recorded why, so the course builder showed "No recording
-- yet" as though the session had never happened.
--
-- One row per lesson or session: where its recording is on the way from the room
-- to storage, the link to retry from, and the reason for any failure. The
-- existing recording_status columns keep their meaning for every reader
-- (available = there is a file members can play).
--
--   recording   the room is recording
--   processing  the room has ended; waiting for JaaS to deliver the file
--   saving      copying the file from JaaS to storage
--   failed      the copy failed (see error); retryable until source_expires_at
--   saved       done; source_url is cleared
--
-- source_url is a pre-authenticated link: anyone holding it can download the
-- recording until it expires. Service role only, cleared once saved. It lives
-- here rather than on training_items so no read of a lesson can pick it up.
--
-- Idempotent: safe to re-run under the CLI or the Supabase MCP.

CREATE TABLE IF NOT EXISTS public.recording_offloads (
  target_kind       text NOT NULL CHECK (target_kind IN ('training', 'session')),
  target_id         uuid NOT NULL,
  status            text NOT NULL CHECK (status IN ('recording', 'processing', 'saving', 'failed', 'saved')),
  source_url        text,
  source_expires_at timestamptz,
  idempotency_key   text,
  error             text,
  size_bytes        bigint,
  attempts          integer NOT NULL DEFAULT 0,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (target_kind, target_id)
);

ALTER TABLE public.recording_offloads ENABLE ROW LEVEL SECURITY;

-- No policies: service role only, as with the rest of the community tables.
-- Grant restated so an MCP apply cannot leave the table unreadable.
REVOKE ALL ON public.recording_offloads FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recording_offloads TO service_role;
