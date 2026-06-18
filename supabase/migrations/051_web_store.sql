-- Migration 051: Web store (PRD §12).
--
-- A native merchandise store on the existing Supabase + Stripe + Printful stack.
-- See docs/WEB-STORE-PLAN.md for the full design. This migration lays the data
-- foundation only (Phase 0); API routes, the storefront and admin UI land in
-- later phases.
--
-- Core concepts encoded here:
--   * Central catalog (store_products / store_variants) — one SKU reused by the
--     public storefront AND event registration.
--   * Two fulfilment timings: 'direct' (Printful order placed at payment) and
--     'batch' (paid up front, fulfilment deferred to one bulk order committed
--     later). Batches ship to one of three destinations: member home (direct),
--     event venue (event_venue batch) or school (educator_campaign batch).
--   * Two discount axes: store_tier_discounts (storefront, by membership tier)
--     and store_event_discounts (event merch — global default + per-event
--     override, mirroring refund_policies from migration 027).
--
-- Conventions follow prior migrations: IF NOT EXISTS guards, gen_random_uuid()
-- PKs, and a single service-role RLS policy scoped TO service_role (the hardened
-- end-state from migration 049). All access is server-side via supabaseServer().

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.store_products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  name            text NOT NULL,
  description     text,
  product_type    text NOT NULL DEFAULT 'merch'
                    CHECK (product_type IN ('apparel', 'merch', 'sticker', 'digital')),
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'active', 'archived')),
  pod_provider    text NOT NULL DEFAULT 'printful'
                    CHECK (pod_provider IN ('printful', 'self')),
  pod_sync_product_id text,                  -- Printful sync product id
  images          jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_event_shirt  boolean NOT NULL DEFAULT false,  -- candidate for an event's "included shirt"
  featured        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.store_variants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid NOT NULL REFERENCES public.store_products(id) ON DELETE CASCADE,
  sku             text NOT NULL UNIQUE,      -- the central SKU
  label           text,                      -- "Black / L"
  options         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {size:'L', color:'Black'}
  market_price_cents int NOT NULL DEFAULT 0, -- storefront / default price
  pod_sync_variant_id text,                  -- Printful sync_variant_id (order line ref)
  inventory_qty   int,                       -- null = POD / unlimited
  active          boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS store_variants_product_idx
  ON public.store_variants (product_id);

-- ---------------------------------------------------------------------------
-- Discounts (two non-stacking axes)
-- ---------------------------------------------------------------------------

-- Axis 1 — storefront pricing by membership tier.
CREATE TABLE IF NOT EXISTS public.store_tier_discounts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_id      uuid NOT NULL REFERENCES public.membership_tiers(id) ON DELETE CASCADE,
  scope        text NOT NULL DEFAULT 'all'
                 CHECK (scope IN ('all', 'product', 'category')),
  product_id   uuid REFERENCES public.store_products(id) ON DELETE CASCADE,
  category     text,
  percent_off  int NOT NULL CHECK (percent_off BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS store_tier_discounts_tier_idx
  ON public.store_tier_discounts (tier_id);

-- Axis 2 — event/campaign merch discounts. scope='global' is the default; a
-- row with scope='event' + event_slug overrides the global for that event.
-- percent_off=100 = the "free" included shirt.
CREATE TABLE IF NOT EXISTS public.store_event_discounts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope        text NOT NULL DEFAULT 'global'
                 CHECK (scope IN ('global', 'event')),
  event_slug   text,                         -- null when global
  product_id   uuid REFERENCES public.store_products(id) ON DELETE CASCADE,
  category     text,
  percent_off  int NOT NULL CHECK (percent_off BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS store_event_discounts_event_idx
  ON public.store_event_discounts (event_slug);

-- Which products an event offers, and how (included shirt vs paid add-on).
CREATE TABLE IF NOT EXISTS public.event_store_offerings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_slug   text NOT NULL,
  variant_id   uuid NOT NULL REFERENCES public.store_variants(id) ON DELETE CASCADE,
  treatment    text NOT NULL CHECK (treatment IN ('included', 'addon')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_store_offerings_event_idx
  ON public.event_store_offerings (event_slug);

-- ---------------------------------------------------------------------------
-- Bulk fulfilment batches (event venue OR educator campaign → school)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.merch_batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_type      text NOT NULL CHECK (batch_type IN ('event_venue', 'educator_campaign')),
  event_slug      text NOT NULL,
  owner_member_id uuid REFERENCES public.members(id) ON DELETE SET NULL,  -- educator who owns a campaign batch
  ship_to         jsonb,                     -- venue (event) or school address (campaign)
  status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'committed', 'ordered', 'shipped', 'received')),
  pod_order_id    text,
  tracking_url    text,
  committed_by    uuid REFERENCES public.members(id) ON DELETE SET NULL,
  committed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merch_batches_event_idx ON public.merch_batches (event_slug);
CREATE INDEX IF NOT EXISTS merch_batches_status_idx ON public.merch_batches (status);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.store_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       uuid REFERENCES public.members(id) ON DELETE SET NULL,  -- null = guest
  email           text NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'paid', 'fulfilling', 'shipped',
                                      'delivered', 'refunded', 'cancelled')),
  channel         text NOT NULL DEFAULT 'storefront'
                    CHECK (channel IN ('storefront', 'event_registration', 'educator_bulk', 'reship')),
  event_slug      text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id   text,
  subtotal_cents  int NOT NULL DEFAULT 0,
  discount_cents  int NOT NULL DEFAULT 0,
  shipping_cents  int NOT NULL DEFAULT 0,
  tax_cents       int NOT NULL DEFAULT 0,
  total_cents     int NOT NULL DEFAULT 0,
  ship_to         jsonb,                     -- home address for direct/reship; null for batched
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_orders_member_idx ON public.store_orders (member_id);
CREATE INDEX IF NOT EXISTS store_orders_event_idx ON public.store_orders (event_slug);
CREATE INDEX IF NOT EXISTS store_orders_checkout_idx
  ON public.store_orders (stripe_checkout_session_id);

CREATE TABLE IF NOT EXISTS public.store_order_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES public.store_orders(id) ON DELETE CASCADE,
  variant_id      uuid REFERENCES public.store_variants(id) ON DELETE SET NULL,
  sku             text,                      -- snapshot
  name            text,                      -- snapshot
  qty             int NOT NULL DEFAULT 1,
  unit_amount_cents int NOT NULL DEFAULT 0,
  line_source     text NOT NULL DEFAULT 'storefront'
                    CHECK (line_source IN ('storefront', 'event_included', 'event_addon', 'reship')),
  fulfillment_mode text NOT NULL DEFAULT 'direct'
                    CHECK (fulfillment_mode IN ('direct', 'batch')),
  fulfillment_status text NOT NULL DEFAULT 'pending'
                    CHECK (fulfillment_status IN ('pending', 'awaiting_batch', 'ordered',
                                                  'shipped', 'collected', 'reshipped', 'cancelled')),
  batch_id        uuid REFERENCES public.merch_batches(id) ON DELETE SET NULL,
  participant_member_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_order_items_order_idx ON public.store_order_items (order_id);
CREATE INDEX IF NOT EXISTS store_order_items_batch_idx ON public.store_order_items (batch_id);
CREATE INDEX IF NOT EXISTS store_order_items_participant_idx
  ON public.store_order_items (participant_member_id);
CREATE INDEX IF NOT EXISTS store_order_items_fulfillment_idx
  ON public.store_order_items (fulfillment_status);

-- ---------------------------------------------------------------------------
-- Addresses (direct / reship only) + returns
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.member_addresses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  label        text,
  line1        text NOT NULL,
  line2        text,
  city         text NOT NULL,
  state        text NOT NULL,
  postcode     text NOT NULL,
  country      text NOT NULL DEFAULT 'US',
  is_default   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS member_addresses_member_idx ON public.member_addresses (member_id);

CREATE TABLE IF NOT EXISTS public.store_returns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES public.store_orders(id) ON DELETE CASCADE,
  member_id       uuid REFERENCES public.members(id) ON DELETE SET NULL,
  reason          text,
  status          text NOT NULL DEFAULT 'requested'
                    CHECK (status IN ('requested', 'approved', 'refunded', 'denied')),
  stripe_refund_id text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_returns_order_idx ON public.store_returns (order_id);

-- ---------------------------------------------------------------------------
-- Per-participant merch collection ack (drives the check-in screen toggle).
-- participants is a core table created outside repo migrations; add columns
-- defensively.
-- ---------------------------------------------------------------------------

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS merch_collected boolean NOT NULL DEFAULT false;
ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS merch_collected_at timestamptz;

-- ---------------------------------------------------------------------------
-- RLS — service role only, scoped TO service_role (migration 049 end-state).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'store_products', 'store_variants', 'store_tier_discounts',
    'store_event_discounts', 'event_store_offerings', 'merch_batches',
    'store_orders', 'store_order_items', 'member_addresses', 'store_returns'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    BEGIN
      EXECUTE format(
        'CREATE POLICY "service role full access %s" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        t, t
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;
