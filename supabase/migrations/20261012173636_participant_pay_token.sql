-- Durable pay token for a "members pay individually" seat (deep review PAY-8).
--
-- Per-seat payment emails embedded the raw Stripe Checkout URL, which expires
-- after 24h, and individual_payment_link_sent_at was stamped so nothing ever
-- re-sent it. A participant (often a sheet-added student with no member account,
-- so the Account → Teams re-mint is out of reach) who opened the email a day
-- later hit "this link has expired" with no way back, and their seat stayed
-- pending so the group never confirmed.
--
-- This mirrors the registration pay_token pattern (migration 20260917160000):
-- the email links to a durable page keyed on this token, and the Checkout is
-- minted on click. 32 random bytes → 64 hex chars, like registrations.pay_token.
--
--   pay_token — per-participant capability token for the per-seat pay page. NULL
--               until a per-seat payment link is first needed.

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS pay_token text;

-- Unique so a token resolves to exactly one seat; partial so the many NULLs
-- (participants that never owe their own seat) don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS participants_pay_token_key
  ON public.participants (pay_token)
  WHERE pay_token IS NOT NULL;
