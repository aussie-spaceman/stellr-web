-- Reserve account credit at checkout-creation time (deep review PAY-9).
--
-- buildCreditDiscount minted a Stripe coupon for the member's full available
-- credit with no reservation, and finalizeRedemption clamped the ledger at zero
-- (remaining = max(0, remaining - amount)). So a member with $100 credit could
-- open two membership checkouts, each carrying a $100 coupon, complete both, and
-- spend $200 of discount from $100 of credit — the ledger clamp hid it.
--
-- The fix reserves credit the moment a coupon is minted, by atomically
-- decrementing account_credits.remaining_cents and recording the hold here. A
-- second concurrent checkout then sees the reduced balance and cannot re-spend
-- it. A reservation whose checkout is abandoned lapses at reserved_expires_at and
-- is released back to the credit (lazily, on the member's next checkout).
--
--   status            — 'settled'  : credit actually consumed by a completed checkout
--                                     (the historical meaning; existing rows default here).
--                       'reserved' : held for an in-flight checkout, not yet settled.
--                       'released' : the reservation lapsed/was cancelled; the hold
--                                     was returned to account_credits.remaining_cents.
--   reservation_id    — groups the rows reserved for one checkout; carried in the
--                       session metadata so the webhook can settle exactly them.
--   reserved_expires_at — when an unsettled reservation lapses (set to just past the
--                       Stripe Checkout session lifetime).

ALTER TABLE public.credit_redemptions
  ADD COLUMN IF NOT EXISTS status              text NOT NULL DEFAULT 'settled',
  ADD COLUMN IF NOT EXISTS reservation_id      text,
  ADD COLUMN IF NOT EXISTS reserved_expires_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.credit_redemptions
    ADD CONSTRAINT credit_redemptions_status_check
    CHECK (status IN ('reserved', 'settled', 'released'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Settle a checkout's reservation by its reservation_id.
CREATE INDEX IF NOT EXISTS credit_redemptions_reservation_idx
  ON public.credit_redemptions (reservation_id)
  WHERE reservation_id IS NOT NULL;

-- Find a member's live reservations to release lapsed ones on their next checkout.
CREATE INDEX IF NOT EXISTS credit_redemptions_reserved_idx
  ON public.credit_redemptions (member_id)
  WHERE status = 'reserved';
