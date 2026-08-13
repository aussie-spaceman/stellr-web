-- Migration 137: individual-payment coverage for participants added after the
-- registration form (Google Sheet sync, organiser manual add) and for free events.
--
-- NUMBERING: authored as 134, renumbered to 137 — 135 and 136 were authored and
-- applied ahead of it, so the old number implied an order that never happened.
-- It was already applied to prod when renumbered, recorded as version
-- 20260813213834 under the name `individual_payment_waived` (without the number
-- prefix that 135_lead_capture_failures and friends carry). The applied record
-- was deliberately left alone rather than rewritten; this note reconciles the two.
--
-- Two problems this supports fixing in code:
--
-- 1. Only the "add now" and join-link paths ever set individual_payment_status.
--    People added via the linked Google Sheet or the organiser's manual add were
--    left NULL, so they never got a payment link, the self-serve payment-link
--    endpoint refused them ("No payment required"), and the Stripe webhook's
--    "is the whole group paid?" check — which counts rows still 'pending' —
--    skipped them entirely and confirmed the registration while they owed money.
--
-- 2. A free event (no stripePriceId in Sanity) combined with "members pay
--    individually" left everyone stuck at 'pending' for a payment that can never
--    be made. 'waived' records "nothing to pay" distinctly from NULL, which keeps
--    its existing meaning of "individual payment doesn't apply to this reg".
--
-- individual_payment_link_sent_at is the idempotency marker for the notification
-- itself. The status was previously stamped BEFORE the email was sent, so a send
-- failure was invisible and unrecoverable, and a sheet re-sync had no way to tell
-- "already emailed" from "needs emailing". Sending is now keyed off this column.
--
-- No backfill: existing rows are demo data.
--
-- Down path (documented, not automated): re-create the CHECK without 'waived'
-- after re-kinding any waived rows, then drop the column.

-- Allow 'waived'. The CHECK was created in migration 008.
ALTER TABLE public.participants
  DROP CONSTRAINT IF EXISTS participants_individual_payment_status_check;

ALTER TABLE public.participants
  ADD CONSTRAINT participants_individual_payment_status_check
  CHECK (individual_payment_status IN ('pending', 'paid', 'waived') OR individual_payment_status IS NULL);

-- When the payment link (or the free-event "no payment required" notice) was
-- emailed to this participant. NULL = never sent, so it still needs sending.
ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS individual_payment_link_sent_at timestamptz;
