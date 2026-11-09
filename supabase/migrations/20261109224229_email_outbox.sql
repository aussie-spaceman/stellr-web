-- Email outbox: mail Resend could not take is delayed, never dropped (9 Nov 2026).
--
-- Resend's Free plan allows 100 emails a day for everything Stellr sends. When
-- Resend refuses a send for a reason that will pass (the daily or monthly
-- quota, the rate limit, an outage, a key or domain problem), sendEmail()
-- (lib/email.ts) writes the finished message here instead of throwing it away,
-- and the email-outbox cron (app/api/cron/email-outbox) sends it once Resend
-- accepts mail again. lib/email/outbox.ts has the rules.
--
-- Plain tables, service-role only, like email_send_quota: every read and write
-- goes through the app's server code. The grants are explicit because a
-- migration applied through the Supabase MCP comes up with none.

CREATE TABLE IF NOT EXISTS public.email_outbox (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'suppressed')),
  kind              text NOT NULL CHECK (kind IN ('transactional', 'marketing')),
  -- 0 transactional, 1 marketing: the drain sends transactional mail first.
  priority          smallint NOT NULL DEFAULT 0,
  critical          boolean NOT NULL DEFAULT false,
  -- Who the sender meant to reach, before dev routing; the suppression list is
  -- checked against these again at send time.
  intended_to       text NOT NULL,
  intended_cc       text[] NOT NULL DEFAULT '{}',
  -- The routed message as it will go to Resend. Attachments are named by
  -- sha256 here and stored once in email_outbox_blobs.
  message           jsonb NOT NULL,
  attachment_hashes text[] NOT NULL DEFAULT '{}',
  reason            text NOT NULL
                      CHECK (reason IN ('daily_quota', 'monthly_quota', 'rate_limit', 'budget', 'provider_error')),
  attempts          int NOT NULL DEFAULT 0,
  last_error        text,
  next_attempt_at   timestamptz NOT NULL DEFAULT now(),
  claimed_at        timestamptz,
  sent_at           timestamptz,
  finished_at       timestamptz,
  provider_id       text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_outbox IS
  'Mail Resend refused for a reason that passes (quota, rate limit, outage), waiting for the email-outbox cron. Delayed, never dropped (lib/email/outbox.ts).';

CREATE INDEX IF NOT EXISTS email_outbox_waiting_idx
  ON public.email_outbox (priority, created_at)
  WHERE status IN ('pending', 'sending');
CREATE INDEX IF NOT EXISTS email_outbox_finished_idx
  ON public.email_outbox (finished_at)
  WHERE status IN ('sent', 'suppressed');

ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_outbox FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_outbox TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access email_outbox"
    ON public.email_outbox FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.email_outbox_blobs (
  sha256     text PRIMARY KEY,
  -- Base64, as Resend takes it.
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_outbox_blobs IS
  'Attachment files of queued mail, one copy per distinct file (lib/email/outbox.ts).';

ALTER TABLE public.email_outbox_blobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_outbox_blobs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_outbox_blobs TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access email_outbox_blobs"
    ON public.email_outbox_blobs FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Remove attachment files no waiting message names. A day's grace, because
-- enqueueEmail writes the file (refreshing created_at) just before the row.
CREATE OR REPLACE FUNCTION public.prune_email_outbox_blobs()
RETURNS int LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  WITH gone AS (
    DELETE FROM public.email_outbox_blobs b
     WHERE b.created_at < now() - interval '1 day'
       AND NOT EXISTS (
         SELECT 1 FROM public.email_outbox o
          WHERE o.status IN ('pending', 'sending')
            AND b.sha256 = ANY (o.attachment_hashes)
       )
    RETURNING 1
  )
  SELECT count(*)::int FROM gone
$$;

REVOKE EXECUTE ON FUNCTION public.prune_email_outbox_blobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_email_outbox_blobs() TO service_role;
