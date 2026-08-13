-- Migration 136: delayed (drip) campaign sends.
--
-- Until now an event campaign fired the instant fireCampaignEvent() was called,
-- so a multi-email welcome sequence was impossible: N campaigns bound to
-- 'member.created' all delivered within the same second. This adds a per-campaign
-- delay and a due-date queue to hold the delayed sends.
--
-- delay_days = 0 keeps the existing behaviour exactly (send inline), so every
-- campaign that exists today is unaffected.

-- ─── email_campaigns: delay + sequence grouping ─────────────────────────────
ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS delay_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sequence_key text;

DO $$ BEGIN
  ALTER TABLE public.email_campaigns
    ADD CONSTRAINT email_campaigns_delay_days_nonneg CHECK (delay_days >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.email_campaigns.delay_days IS
  'Days after the trigger event before sending. 0 = send inline (default).';
COMMENT ON COLUMN public.email_campaigns.sequence_key IS
  'Optional label grouping the campaigns of one drip sequence in the admin UI.';

-- ─── email_campaign_queue ───────────────────────────────────────────────────
-- One row per (campaign, member, occurrence) awaiting its due date. Drained by
-- /api/cron/campaign-drip.
--
-- The unique constraint is the idempotency contract, and mirrors
-- email_campaign_sends: dedup_key distinguishes legitimate re-occurrences of a
-- recurring event (e.g. a yearly renewal) from a duplicate fire of the same one.
-- COALESCE'd to '' because NULLs don't collide in a UNIQUE index, which would
-- silently permit exactly the double-enqueue this is meant to prevent.
CREATE TABLE IF NOT EXISTS public.email_campaign_queue (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  due_at      timestamptz NOT NULL,
  dedup_key   text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
  -- Why a drained row didn't send (unsubscribed, deactivated, template gone).
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS email_campaign_queue_unique_idx
  ON public.email_campaign_queue(campaign_id, member_id, dedup_key);

-- The cron's only read path: pending rows that have come due, oldest first.
CREATE INDEX IF NOT EXISTS email_campaign_queue_due_idx
  ON public.email_campaign_queue(due_at)
  WHERE status = 'pending';

ALTER TABLE public.email_campaign_queue ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access email_campaign_queue"
    ON public.email_campaign_queue FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
