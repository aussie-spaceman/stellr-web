-- Migration 022: Email campaign engine (Layer 3 — DB-backed reusable templates).
--   * email_templates       — staff-authored, reusable bodies (Tiptap JSON) + subject
--   * email_campaigns        — a template + audience segment + trigger config
--   * email_campaign_sends   — per-(campaign,member) idempotency ledger
--   * members marketing cols — consent + one-click unsubscribe token (CAN-SPAM/CASL)
--
-- Conventions follow prior migrations: gen_random_uuid() PKs, service-role RLS,
-- idempotency modelled on sent_reminders (migration 021).

-- ─── email_templates ────────────────────────────────────────────────────────
-- Reusable content authored by staff in the admin UI (no code deploy). body_json
-- is the Tiptap doc; subject is plain text. Both may contain {{mergeFields}}
-- (see lib/email-vars.ts for the supported token vocabulary).
CREATE TABLE IF NOT EXISTS public.email_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text UNIQUE NOT NULL,          -- stable slug, e.g. 'welcome-alumni'
  name        text NOT NULL,                 -- human label shown in the picker
  subject     text NOT NULL,                 -- may contain {{tokens}}
  body_json   jsonb,                         -- Tiptap doc (what staff edits)
  is_archived boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access email_templates"
    ON public.email_templates FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── email_campaigns ────────────────────────────────────────────────────────
-- A scheduled or event-triggered send of one template to a computed audience.
--   trigger_type='scheduled' → sent once when now >= scheduled_at (cron-driven)
--   trigger_type='event'     → sent to a single member when app code fires
--                              fireCampaignEvent(event_key, …) (see lib/campaigns.ts)
-- audience is a structured filter (never raw SQL) resolved at send time:
--   { activeOnly: bool, excludeMinors: bool, tierIds: string[] | null }
-- Marketing consent suppression is ALWAYS enforced on top of the audience.
CREATE TABLE IF NOT EXISTS public.email_campaigns (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  template_id  uuid NOT NULL REFERENCES public.email_templates(id) ON DELETE RESTRICT,
  trigger_type text NOT NULL CHECK (trigger_type IN ('scheduled', 'event')),
  scheduled_at timestamptz,                  -- required when trigger_type='scheduled'
  event_key    text,                         -- required when trigger_type='event'
  audience     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','scheduled','sending','sent','paused','archived')),
  created_by   uuid REFERENCES public.members(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz                   -- set when a one-time campaign completes
);

CREATE INDEX IF NOT EXISTS email_campaigns_due_idx
  ON public.email_campaigns(status, scheduled_at)
  WHERE trigger_type = 'scheduled';
CREATE INDEX IF NOT EXISTS email_campaigns_event_idx
  ON public.email_campaigns(event_key, status)
  WHERE trigger_type = 'event';

ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access email_campaigns"
    ON public.email_campaigns FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── email_campaign_sends ───────────────────────────────────────────────────
-- One row per delivered (or failed/suppressed) recipient. UNIQUE makes the
-- dispatcher idempotent and resumable. dedup_key distinguishes legitimate
-- re-sends of event campaigns (e.g. a yearly renewal nudge keyed by year);
-- it is '' for one-time scheduled campaigns.
CREATE TABLE IF NOT EXISTS public.email_campaign_sends (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  dedup_key   text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'sent'
                CHECK (status IN ('sent','failed','suppressed')),
  error       text,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, member_id, dedup_key)
);

CREATE INDEX IF NOT EXISTS email_campaign_sends_campaign_idx
  ON public.email_campaign_sends(campaign_id);

ALTER TABLE public.email_campaign_sends ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access email_campaign_sends"
    ON public.email_campaign_sends FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── members marketing consent ──────────────────────────────────────────────
-- Distinct from member_notification_prefs (migration 017), which governs
-- TRANSACTIONAL notifications. Marketing/campaign mail is legally separate and
-- needs its own opt-out + a tokenised one-click unsubscribe link (no auth).
-- Defaults to opt-in for the existing base (CAN-SPAM opt-out model); the
-- unsubscribe endpoint flips marketing_consent=false. Review per-jurisdiction
-- (CASL is opt-in) before first send — see [[project_school_official_agreement]].
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS marketing_consent boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS marketing_unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS marketing_unsubscribed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS members_unsub_token_idx
  ON public.members(marketing_unsubscribe_token);
