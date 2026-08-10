-- Migration 135: dead-letter queue for public lead captures that never reached
-- HubSpot.
--
-- HubSpot is the source of truth for every lead route on stellreducation.org
-- (event notify-me, newsletter, white paper, asset request, scholarship, host
-- an event). That makes a failed write data loss with no trace: the visitor
-- saw "You're on the list", and nobody has a record that they ever asked.
--
-- This table is NOT a second source of truth and must not be read as one. It
-- holds only the captures that failed, so a person who slipped through is a
-- queue item somebody can replay into HubSpot rather than a silent gap. The
-- capture path also emails CONTACT_EMAIL on insert (see lib/hubspot.ts), so a
-- row appearing here is meant to be noticed, actioned, and resolved.
--
-- Retention: rows are expected to be short-lived. Resolve by replaying into
-- HubSpot and setting resolved_at; nothing prunes automatically.
--
-- Down path (documented, not automated): DROP TABLE public.lead_capture_failures.

CREATE TABLE IF NOT EXISTS public.lead_capture_failures (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),

  email        text NOT NULL,
  -- Matches the LeadSource keys in lib/hubspot-fields.ts. Deliberately text
  -- rather than an enum: a new lead route should never fail its dead-letter
  -- write because a migration hasn't shipped yet.
  source       text NOT NULL,
  -- Why the capture failed: form-submit-failed:400, all-writes-failed, etc.
  reason       text NOT NULL,
  -- Full submitted payload, so the capture can be replayed without the
  -- original request.
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,

  resolved_at  timestamptz,
  resolved_by  text,
  notes        text
);

-- The working query is "what is still outstanding, oldest first".
CREATE INDEX IF NOT EXISTS lead_capture_failures_unresolved_idx
  ON public.lead_capture_failures (created_at)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS lead_capture_failures_email_idx
  ON public.lead_capture_failures (lower(email));

-- Contains marketing-lead PII and is written only by the service role from
-- server routes. RLS on with no policies = no anon/authenticated access at all,
-- which is the intent; the service role bypasses RLS.
ALTER TABLE public.lead_capture_failures ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.lead_capture_failures IS
  'Dead-letter queue for lead captures that failed to reach HubSpot. Recovery net only — HubSpot remains the source of truth.';
