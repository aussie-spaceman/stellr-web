-- Migration 148: recipient-level DocuSign state, and a chase cadence that
-- doesn't stop after one reminder.
--
-- WHY (4 Sept 2026): a parent wrote in saying "we signed the consent form last
-- week, why does it say we haven't?". Answering that took a DB query plus a live
-- DocuSign API call, because we persisted only an envelope-level status and two
-- integers (signers_total / signers_completed, migration 032). Those can say
-- "1 of 2 signed"; they can never say WHICH signer is outstanding — which is the
-- only question anyone actually asks. Three separate UI surfaces each invented
-- their own vocabulary on top of those two integers and none of them could name
-- a person.
--
-- Two further signals were being thrown away entirely. The DocuSign recipients
-- API reports `autoresponded` when a recipient's address bounces (proven in our
-- own account) and a per-recipient deliveredDateTime meaning "opened the link".
-- A guardian whose email hard-bounced looked identical to one who was merely
-- slow, and "never opened it in nine days" looked identical to "opened it
-- yesterday". Both are now stored.
--
-- The webhook already calls GET /envelopes/{id}/recipients on every
-- recipient-completed event and discards all but two counts. This table is fed
-- from that same response, so it costs no extra DocuSign calls.

CREATE TABLE IF NOT EXISTS public.docusign_envelope_recipients (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_row   uuid NOT NULL REFERENCES public.docusign_envelopes(id) ON DELETE CASCADE,
  -- DocuSign's own recipientId, unique within an envelope. Stable across
  -- resends, which is what makes the upsert below idempotent.
  recipient_id   text NOT NULL,
  -- Template role: Guardian | Minor | Adult | Mentor | Volunteer |
  -- StellrRepresentative. Null for the non-template fallback envelopes in
  -- createConsentEnvelope(), which build signers directly.
  role_name      text,
  name           text NOT NULL,
  email          text NOT NULL,
  -- DocuSign recipient status, lower-cased. 'autoresponded' = the address
  -- bounced; it is NOT in the envelope-level status vocabulary (migration 010).
  status         text NOT NULL
                 CHECK (status IN ('created','sent','delivered','completed',
                                   'declined','autoresponded','signed','faxpending')),
  routing_order  int,
  -- Null delivered_at on a 'sent' recipient means they have never opened the
  -- signing link. That distinction drives the chase copy.
  delivered_at   timestamptz,
  signed_at      timestamptz,
  declined_at    timestamptz,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (envelope_row, recipient_id)
);

CREATE INDEX IF NOT EXISTS docusign_envelope_recipients_envelope_idx
  ON public.docusign_envelope_recipients (envelope_row);

-- "Who is outstanding across every open envelope" — the admin chase list.
CREATE INDEX IF NOT EXISTS docusign_envelope_recipients_status_idx
  ON public.docusign_envelope_recipients (status)
  WHERE status <> 'completed';

COMMENT ON TABLE public.docusign_envelope_recipients IS
  'One row per DocuSign recipient, synced from the recipients API by the Connect webhook. Source of truth for WHO is outstanding on a partially-signed envelope.';

-- RLS: identical posture to migration 048 for docusign_envelopes. This table
-- holds the same PII (signer names/emails, minors), every code path uses the
-- service-role client which bypasses RLS, and the policy is scoped TO
-- service_role — NOT the older TO public / USING(true) pattern, which leaves a
-- table open to the anon key shipped in every browser.
ALTER TABLE public.docusign_envelope_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role full access docusign_envelope_recipients"
  ON public.docusign_envelope_recipients;
CREATE POLICY "service role full access docusign_envelope_recipients"
  ON public.docusign_envelope_recipients
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── Chase cadence ────────────────────────────────────────────────────────────
-- The reminder cron filtered on `reminder_sent_at IS NULL`, and BOTH the cron
-- and the admin resend route write that column. Consequence: every envelope was
-- chased at most once ever, and an admin pressing "Resend" permanently removed
-- that envelope from automated chasing. The Buk consent form was issued 26 Aug,
-- reminded once on 3 Sep, and would never have been chased again.
--
-- reminder_count lets the cron re-chase on an interval with a hard cap, and
-- last_manual_resend_at keeps a human action from disabling the automation.
ALTER TABLE public.docusign_envelopes
  ADD COLUMN IF NOT EXISTS reminder_count        int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_manual_resend_at timestamptz;

COMMENT ON COLUMN public.docusign_envelopes.reminder_count IS
  'Automated chases sent so far. Capped in the reminder cron; not incremented by admin resends.';
COMMENT ON COLUMN public.docusign_envelopes.last_manual_resend_at IS
  'Last admin-triggered resend. Deliberately separate from reminder_sent_at so a manual resend does not stop the cron.';

-- Envelopes already reminded under the old single-shot rule have had exactly one
-- chase. Recording that keeps the new cap honest rather than granting them a
-- fresh full allowance.
UPDATE public.docusign_envelopes
SET reminder_count = 1
WHERE reminder_sent_at IS NOT NULL
  AND reminder_count = 0;
