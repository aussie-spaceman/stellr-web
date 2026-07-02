-- Migration 119: Video watermark job queue.
--
-- Vercel can't run ffmpeg inline (binary size + function timeout), so private,
-- access-gated videos (JaaS session/training recordings offloaded by
-- app/api/webhooks/recording, and admin-uploaded training-lesson videos) can't
-- be watermarked at request time. Instead the upload/offload paths ENQUEUE a job
-- here, and a standalone Node worker (scripts/watermark-worker.ts, run on any box
-- with ffmpeg) claims pending jobs, burns "© Stellr Education" into the file, and
-- overwrites it in Supabase Storage.
--
-- storage_path is unique: every offload writes a fresh timestamped path, so a new
-- upload is always a new job; re-enqueuing the same path just resets it to pending.
--
-- Service-role only: the worker and the app both use the service key, so RLS is
-- enabled with NO policies to lock anon/authenticated out entirely.

create table if not exists public.video_watermark_jobs (
  id            uuid primary key default gen_random_uuid(),
  bucket        text not null,
  storage_path  text not null unique,
  kind          text not null check (kind in ('recording', 'training')),
  status        text not null default 'pending'
                  check (status in ('pending', 'processing', 'done', 'failed')),
  attempts      int  not null default 0,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The worker polls for actionable jobs; keep that lookup cheap.
create index if not exists idx_vwj_actionable
  on public.video_watermark_jobs (created_at)
  where status in ('pending', 'processing');

alter table public.video_watermark_jobs enable row level security;
-- (no policies — service-role bypasses RLS; everyone else is denied)
