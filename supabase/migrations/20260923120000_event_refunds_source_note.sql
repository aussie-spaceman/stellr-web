-- Refunds made outside the app, and deletions with no refund.
--
-- On 23 Sept 2026 a Colorado registration was refunded in full by hand in the
-- Stripe dashboard. The app never heard about it: no webhook handled refunds,
-- and "already refunded" only looked at event_refunds. Deleting the registration
-- would then have issued a second refund (an account credit) on top.
--
--   source  — 'admin' for a refund decided in the delete dialog; 'stripe_external'
--             for one made in the Stripe dashboard (recorded by the charge.refunded
--             webhook, or detected at delete time by asking Stripe).
--   note    — the admin's reason for "No refund — remove only", or the Stripe detail.
--   currency— the refund's currency, so the roster can show the amount honestly.
--
-- stripe_refund_id becomes unique so a redelivered charge.refunded webhook is a
-- no-op. It is a full (not partial) unique index because PostgREST's on_conflict
-- cannot target a partial index; NULLs stay distinct, so audit rows without a
-- Stripe refund are unaffected.

ALTER TABLE public.event_refunds
  ADD COLUMN IF NOT EXISTS source   text NOT NULL DEFAULT 'admin',
  ADD COLUMN IF NOT EXISTS note     text,
  ADD COLUMN IF NOT EXISTS currency text;

DO $$ BEGIN
  ALTER TABLE public.event_refunds
    ADD CONSTRAINT event_refunds_source_check CHECK (source IN ('admin', 'stripe_external'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS event_refunds_stripe_refund_id_key
  ON public.event_refunds (stripe_refund_id);
