-- Resumable registration payment (17 Sept 2026).
--
-- A registration is fully created before payment, but the only way to pay was
-- the one-time Stripe redirect at the end of the form. A parent who closed the
-- tab had no way back: the cancel URL landed on a blank form and resubmitting
-- was refused as a duplicate. pay_token is a capability that lets the
-- registrant (or their guardian / organiser) return to a public pay page and
-- mint a fresh Checkout for the same registration — nothing more. It is only
-- honoured while status = 'pending' and registration is open, so it needs no
-- expiry of its own. Minted lazily, so pre-existing pending rows get one the
-- first time anything needs it.
--
-- pay_link_sent_at rate-limits the email: a resubmitted form re-sends the
-- link, and without a stamp the public form could be used to flood an inbox.

ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS pay_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS pay_link_sent_at timestamptz;

COMMENT ON COLUMN public.registrations.pay_token IS
  'Capability token for /register/[slug]/pay/[token]; 32 random bytes hex, minted lazily. Only usable while status = pending.';
COMMENT ON COLUMN public.registrations.pay_link_sent_at IS
  'When the "complete your registration" pay-link email last went out; gates re-sends from the public form.';
