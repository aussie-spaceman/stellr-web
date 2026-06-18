-- Migration 056: link store orders to a registration (PRD §12, store Phase 3).
--
-- Event-merch orders (the included shirt + registration add-ons) are created when
-- a registration is confirmed. Tying the order to its registration gives us
-- (a) idempotency — one event-merch order per registration, so webhook retries
-- don't duplicate the free-shirt allocation — and (b) a clean grouping key for
-- the Event Manager's bulk batch in Phase 4.

ALTER TABLE public.store_orders
  ADD COLUMN IF NOT EXISTS registration_id uuid REFERENCES public.registrations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS store_orders_registration_idx
  ON public.store_orders (registration_id);
