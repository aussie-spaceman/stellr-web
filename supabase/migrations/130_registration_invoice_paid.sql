-- 130_registration_invoice_paid.sql
-- Per-invoice payment tracking for group registrations.
--
-- Invoiced group registrations had no "paid" signal: the UI keyed off
-- registrations.status='confirmed', which is NOT proof of payment (it's set on
-- card checkout / campaign auto-confirm and reused for access gating). That made
-- unpaid group invoices display as "Invoice Paid".
--
-- These columns record when an admin marks the invoice settled, so the member
-- billing/teams pills and the admin roster can show a truthful paid state and
-- offer a receipt only once payment is real.

ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS invoice_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_paid_by uuid REFERENCES public.members(id) ON DELETE SET NULL;
