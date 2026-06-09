-- Migration 006: Teams portal support
-- Adds teacher_member_id FK to registrations, stores spreadsheet_id,
-- and creates sheet_watch_channels for Google push notifications.

-- Link registrations to the teacher's member record
ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS teacher_member_id UUID REFERENCES public.members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS registrations_teacher_member_id_idx
  ON public.registrations(teacher_member_id);

-- Backfill: connect existing registrations to members by matching teacher_email
UPDATE public.registrations r
SET teacher_member_id = m.id
FROM public.members m
WHERE r.teacher_email = m.email
  AND r.teacher_member_id IS NULL;

-- Store the Google Sheet ID so we can sync and watch it
ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS spreadsheet_id TEXT;

-- Track active Google Drive push notification channels per registration
CREATE TABLE IF NOT EXISTS public.sheet_watch_channels (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  registration_id UUID NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  channel_id    TEXT NOT NULL UNIQUE,
  resource_id   TEXT,
  expiration    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sheet_watch_channels_registration_id_idx
  ON public.sheet_watch_channels(registration_id);
CREATE INDEX IF NOT EXISTS sheet_watch_channels_channel_id_idx
  ON public.sheet_watch_channels(channel_id);

ALTER TABLE public.sheet_watch_channels ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access"
    ON public.sheet_watch_channels
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
