-- Migration 027: Registration deletion refunds + refund-rules engine
--
-- When an admin deletes a paid registration/participant, the fee is refunded
-- per a configurable policy: cash (Stripe refund) and/or account credit valid
-- for a configurable window. Tables:
--   * refund_policies   — global default + per-event override (tiered schedule).
--   * account_credits   — monetary credit ledger issued on deletion, redeemable
--                         against future checkouts; expires after N days.
--   * credit_redemptions— record of credit applied to a checkout.
--   * event_refunds     — audit row per refund action (cash/credit/manual).
-- Plus a stored Stripe payment reference on participants/registrations so cash
-- refunds can target the original payment_intent.
--
-- All tables are service-role only (RLS), matching migrations 023/026.

-- ---------------------------------------------------------------------------
-- Payment reference (closes the gap: today only individual_payment_status='paid'
-- is recorded, with no link back to the Stripe payment).
-- ---------------------------------------------------------------------------
ALTER TABLE public.participants  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;

-- ---------------------------------------------------------------------------
-- refund_policies
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.refund_policies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       text NOT NULL CHECK (scope IN ('global', 'event')),
  event_slug  text UNIQUE,                 -- null for the global row
  tiers       jsonb NOT NULL,
  updated_by  uuid REFERENCES public.members(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Exactly one global row.
CREATE UNIQUE INDEX IF NOT EXISTS refund_policies_global_uniq
  ON public.refund_policies (scope) WHERE scope = 'global';

ALTER TABLE public.refund_policies ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access refund_policies"
    ON public.refund_policies FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Seed the global default schedule (cash / credit percentages by days-out).
INSERT INTO public.refund_policies (scope, event_slug, tiers)
SELECT 'global', NULL, '[
  { "minDaysOut": 90, "cashPct": 100, "creditPct": null, "creditValidityDays": null },
  { "minDaysOut": 30, "cashPct": 50,  "creditPct": 75,   "creditValidityDays": 730 },
  { "minDaysOut": 14, "cashPct": 33,  "creditPct": 50,   "creditValidityDays": 730 },
  { "minDaysOut": 0,  "cashPct": null, "creditPct": 25,  "creditValidityDays": 730 }
]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.refund_policies WHERE scope = 'global');

-- ---------------------------------------------------------------------------
-- account_credits
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_credits (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id              uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  currency               text NOT NULL,
  amount_cents           integer NOT NULL CHECK (amount_cents > 0),
  remaining_cents        integer NOT NULL CHECK (remaining_cents >= 0),
  status                 text NOT NULL DEFAULT 'available'
                           CHECK (status IN ('available', 'partially_redeemed', 'redeemed', 'expired')),
  source_type            text NOT NULL DEFAULT 'registration_refund',
  source_participant_id  uuid,
  source_registration_id uuid REFERENCES public.registrations(id) ON DELETE SET NULL,
  reason                 text,
  expires_at             timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_credits_member_idx
  ON public.account_credits (member_id, status, expires_at);

ALTER TABLE public.account_credits ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access account_credits"
    ON public.account_credits FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- credit_redemptions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.credit_redemptions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id                   uuid NOT NULL REFERENCES public.account_credits(id) ON DELETE CASCADE,
  member_id                   uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  amount_cents                integer NOT NULL CHECK (amount_cents > 0),
  stripe_checkout_session_id  text,
  applied_to                  text,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_redemptions_credit_idx
  ON public.credit_redemptions (credit_id);

ALTER TABLE public.credit_redemptions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access credit_redemptions"
    ON public.credit_redemptions FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- event_refunds (audit)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_refunds (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id       uuid,
  registration_id      uuid REFERENCES public.registrations(id) ON DELETE SET NULL,
  member_id            uuid REFERENCES public.members(id) ON DELETE SET NULL,
  event_slug           text,
  paid_cents           integer,
  refund_type          text NOT NULL CHECK (refund_type IN ('cash', 'credit', 'manual_required', 'none')),
  refund_pct           integer,
  refund_cents         integer,
  credit_validity_days integer,
  days_out             integer,
  stripe_refund_id     text,
  account_credit_id    uuid REFERENCES public.account_credits(id) ON DELETE SET NULL,
  decided_by           uuid REFERENCES public.members(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_refunds_participant_idx ON public.event_refunds (participant_id);
CREATE INDEX IF NOT EXISTS event_refunds_event_idx       ON public.event_refunds (event_slug);

ALTER TABLE public.event_refunds ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access event_refunds"
    ON public.event_refunds FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
