-- Migration 056: Printful fulfilment fields on store_orders (PRD §12, store Phase 2).
--
-- Direct-to-consumer storefront orders place a Printful order at payment time and
-- receive tracking via the Printful webhook. store_orders needs somewhere to hold
-- the Printful order id and tracking URL (merch_batches carries these for the
-- event-batched path; direct orders need their own).

ALTER TABLE public.store_orders ADD COLUMN IF NOT EXISTS pod_order_id text;
ALTER TABLE public.store_orders ADD COLUMN IF NOT EXISTS tracking_url text;
