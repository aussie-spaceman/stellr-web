-- 079_workshop_containers.sql
-- Rec 3 of the Workshops & Cohorts access plan (docs/WORKSHOP-COHORT-ACCESS-PLAN.md).
--
-- Coaching WORKSHOPS become a first-class, discoverable, multi-seat, purchasable
-- container that mirrors mentoring cohorts:
--   workshop = mentoring_cohorts(container_type='workshop'), coach = mentor_member_id,
--   participants on the cohort_members roster.
-- The pricing/discovery columns (theme, timezone, planned_sessions, is_open, blurb,
-- free_for_tier_ids, one_off_price_cents, one_off_stripe_price_id, credit_cost) were
-- already added to mentoring_cohorts in 070 — they apply to every row regardless of
-- container_type, so NO new columns are needed here. The legacy 1:1 backfill
-- containers (container_type='coaching', migration 064) are left untouched.

-- ─── 1. Discover index for open workshops ───────────────────────────────────
CREATE INDEX IF NOT EXISTS mentoring_cohorts_open_workshop_idx
  ON public.mentoring_cohorts(is_open) WHERE container_type = 'workshop';

-- ─── 2. platform_pricing: flat default prices (Decision D5) ─────────────────
-- Single-row settings table for the FLAT default price of any cohort / any
-- workshop, and the per-credit top-up unit prices. Container rows seed their
-- one_off_price_cents / credit_cost from these at create time; per-container
-- columns already exist, so moving to variable pricing later is a data edit
-- (no migration). Admin-editable.
CREATE TABLE IF NOT EXISTS public.platform_pricing (
  id                            boolean PRIMARY KEY DEFAULT true CHECK (id),  -- single-row guard
  cohort_price_cents            integer NOT NULL DEFAULT 0,
  workshop_price_cents          integer NOT NULL DEFAULT 0,
  cohort_credit_price_cents     integer NOT NULL DEFAULT 4000,  -- matches CREDIT_PACK_PRICE_CENTS
  workshop_credit_price_cents   integer NOT NULL DEFAULT 4000,
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.platform_pricing (id) VALUES (true)
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_pricing ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access platform_pricing"
    ON public.platform_pricing FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
