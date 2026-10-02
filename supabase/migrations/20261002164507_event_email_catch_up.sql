-- Event Email catch-ups: people who register after an "All participants" email
-- has gone out get it automatically (cron) or on an admin's click. Each catch-up
-- is its own row in event_email_sends, trigger 'catch_up'.
--
-- catch_up_claimed_at  a short lease so the cron and a click can't both send
--                      the same catch-up. Cleared when the run finishes; a
--                      lease older than 5 minutes is treated as abandoned.

ALTER TABLE public.event_email_sends DROP CONSTRAINT IF EXISTS event_email_sends_trigger_check;
ALTER TABLE public.event_email_sends
  ADD CONSTRAINT event_email_sends_trigger_check
  CHECK (trigger IN ('manual', 'schedule', 'test', 'catch_up'));

ALTER TABLE public.event_emails ADD COLUMN IF NOT EXISTS catch_up_claimed_at timestamptz;
