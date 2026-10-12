-- Track the open Checkout session per registration (deep review PAY-4 part-1).
--
-- A registration could end up with several live Stripe Checkout sessions at once
-- — the student is redirected to one while the registrant + emergency contact
-- are emailed a pay link (a second session), and the billing tab / pay page can
-- mint more. None expired the previous one, so a family could complete two and be
-- charged twice; the webhook's duplicate-refund (PAY-4) only compensates AFTER
-- the second charge lands. Persisting the session id lets createRegistrationCheckout
-- expire the prior session BEFORE minting a new one, closing the window.
--
--   checkout_session_id — the most recent Stripe Checkout session minted for this
--                         registration's whole-registration (card) payment. NULL
--                         until the first checkout is minted.

ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS checkout_session_id text;
