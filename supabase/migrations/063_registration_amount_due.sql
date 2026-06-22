-- Migration 063: explicit "amount due" on a registration, for the payment access
-- gate (convergence P2 fix). amount_due_cents = the per-seat event fee × seats,
-- captured at registration time; 0 when the event is free (no Stripe price).
--
-- The gate (lib/access-gates.ts) treats 0 / NULL as "nothing owed", so free
-- registrations — campaigns are free-to-join after the content-tier retirement,
-- and free live events — are never blocked on payment. Legacy rows stay NULL
-- (treated as free): they predate the column and are mostly test data; new
-- registrations get an accurate amount.
ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS amount_due_cents integer;
