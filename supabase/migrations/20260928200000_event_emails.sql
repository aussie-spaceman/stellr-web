-- Event Email Reminders: the "Email Reminders" tab on the event management page.
-- Plan: docs/handovers/HANDOVER-event-email-reminders-2026-09-28.md.
--
-- event_emails       one editable email per row: audiences, merge-field subject
--                    and TipTap body, attachments, and an optional schedule
--                    ("N days before the event").
-- event_email_sends  the history — one row per send (manual, scheduled or test),
--                    with each recipient's outcome. No open/read tracking.

CREATE TABLE IF NOT EXISTS public.event_emails (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_slug            text NOT NULL,
  name                  text NOT NULL,
  template_key          text,
  audiences             text[] NOT NULL DEFAULT '{}',
  subject               text NOT NULL DEFAULT '',
  body_json             jsonb,
  -- [{ path, filename, size, contentType }] in the community-resources bucket
  attachments           jsonb NOT NULL DEFAULT '[]'::jsonb,
  resend_docusign       boolean NOT NULL DEFAULT false,
  schedule_days_before  integer CHECK (schedule_days_before IS NULL OR schedule_days_before BETWEEN 0 AND 365),
  status                text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled', 'skipped')),
  created_by            text,
  sent_at               timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_emails_slug_idx ON public.event_emails (event_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS event_emails_scheduled_idx ON public.event_emails (status) WHERE status = 'scheduled';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_emails TO service_role;
ALTER TABLE public.event_emails ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access event_emails"
    ON public.event_emails FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER event_emails_updated_at
    BEFORE UPDATE ON public.event_emails
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.event_email_sends (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_email_id   uuid REFERENCES public.event_emails(id) ON DELETE SET NULL,
  event_slug       text NOT NULL,
  email_name       text NOT NULL,
  subject          text NOT NULL,
  audiences        text[] NOT NULL DEFAULT '{}',
  trigger          text NOT NULL CHECK (trigger IN ('manual', 'schedule', 'test')),
  triggered_by     text,
  recipient_count  integer NOT NULL DEFAULT 0,
  sent_count       integer NOT NULL DEFAULT 0,
  failed_count     integer NOT NULL DEFAULT 0,
  docusign_resent  integer NOT NULL DEFAULT 0,
  -- [{ email, name, roles[], status: 'sent'|'failed', error? }]
  recipients       jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz
);

CREATE INDEX IF NOT EXISTS event_email_sends_slug_idx ON public.event_email_sends (event_slug, started_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_email_sends TO service_role;
ALTER TABLE public.event_email_sends ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access event_email_sends"
    ON public.event_email_sends FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
