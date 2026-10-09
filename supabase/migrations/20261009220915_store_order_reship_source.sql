-- Link a reship order back to the event-merch order it reships (deep review PAY-2).
--
-- /api/store/reship copied a registration's whole event-merch order into a new
-- $0 reship order for the $5.95 shipping fee, with no record of which source
-- order it came from. That let the same order be reshipped again and again (and,
-- for a group, shipped every participant's shirt to the organiser). We now key
-- each reship to its source order so the route can enforce "one reship per
-- source order". The unique partial index is the race-safe backstop: two
-- concurrent reship requests for the same source order cannot both insert.
--
--   source_order_id — the event-merch store_orders.id this reship fulfils.

ALTER TABLE public.store_orders
  ADD COLUMN IF NOT EXISTS source_order_id uuid REFERENCES public.store_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS store_orders_source_order_idx
  ON public.store_orders (source_order_id);

-- At most one live reship per source order. A cancelled reship is excluded so a
-- genuinely cancelled attempt doesn't permanently block the source order, while
-- a second simultaneous reship still collides on the unique key.
CREATE UNIQUE INDEX IF NOT EXISTS store_orders_one_reship_per_source
  ON public.store_orders (source_order_id)
  WHERE channel = 'reship' AND source_order_id IS NOT NULL AND status <> 'cancelled';
