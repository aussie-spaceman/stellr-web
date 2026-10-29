-- Group invoices (29 Oct 2026): a ledger of every Stripe invoice issued for a
-- group registration, and the discount an admin applied to the group.
--
-- A group's invoice now changes after it is sent: removing a participant
-- revises it (Stripe voids the old one and issues a revision), an admin can
-- add a discount code, and adding a participant after payment raises a
-- separate invoice for the extra place. The ledger is how the app finds the
-- current invoice without Stripe search (which lags), works out what one place
-- actually cost after a discount (for refunds), and tells the organiser in
-- the Billing tab why each invoice exists. Stripe stays the source of truth
-- for status: the app re-reads an invoice before acting on it.
--
-- lib/group-billing.ts writes it; the invoice.paid webhook stamps payment.
--
-- Idempotent: safe to re-run under the CLI or the Supabase MCP.

CREATE TABLE IF NOT EXISTS public.group_invoices (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Financial records outlive a deleted registration (7-year retention).
  registration_id             uuid REFERENCES public.registrations(id) ON DELETE SET NULL,
  event_slug                  text,
  stripe_invoice_id           text NOT NULL,
  stripe_invoice_number       text,
  -- 'seats': the group's main invoice (revised as the group changes).
  -- 'additional': places added after the main invoice was paid.
  kind                        text NOT NULL CHECK (kind IN ('seats', 'additional')),
  status                      text NOT NULL CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible')),
  seats                       integer NOT NULL CHECK (seats >= 0),
  per_seat_cents              integer NOT NULL CHECK (per_seat_cents >= 0),
  subtotal_cents              integer NOT NULL DEFAULT 0,
  discount_cents              integer NOT NULL DEFAULT 0,
  total_cents                 integer NOT NULL DEFAULT 0,
  currency                    text NOT NULL DEFAULT 'usd',
  coupon_id                   text,
  promotion_code              text,
  -- The invoice this one revised (Stripe voided it on finalisation).
  replaces_stripe_invoice_id  text,
  -- Plain-language reason, shown to the organiser in the Billing tab.
  reason                      text,
  -- 'additional' invoices: the participants the extra places are for.
  participant_ids             uuid[] NOT NULL DEFAULT '{}',
  payment_intent_id           text,
  paid_at                     timestamptz,
  voided_at                   timestamptz,
  created_by                  uuid REFERENCES public.members(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS group_invoices_stripe_invoice_id_key ON public.group_invoices (stripe_invoice_id);
CREATE INDEX IF NOT EXISTS group_invoices_registration_idx ON public.group_invoices (registration_id, created_at);
CREATE INDEX IF NOT EXISTS group_invoices_payment_intent_idx ON public.group_invoices (payment_intent_id) WHERE payment_intent_id IS NOT NULL;

ALTER TABLE public.group_invoices ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access group_invoices"
    ON public.group_invoices FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The discount an admin applied to this group's invoices. Kept on the
-- registration so a revision after a roster change carries it forward.
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS invoice_coupon_id text;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS invoice_promotion_code text;

-- Grants restated so an MCP apply cannot leave the new table unreadable.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_invoices TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.registrations TO service_role;
