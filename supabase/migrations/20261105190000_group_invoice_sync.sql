-- Group invoices wait for the roster to settle (5 Nov 2026).
--
-- A group's unpaid invoice used to be reissued, and emailed, on every roster
-- change. Now each change pushes invoice_sync_due_at forward, and the invoice is
-- updated once the roster has been quiet for a couple of minutes.
-- invoice_sync_lock_until is a lease held while the group's main invoice is being
-- changed, so two updates can't race on one Stripe draft.
--
-- lib/group-billing.ts reads and writes both; the group-invoice-sync cron finds
-- overdue updates through the partial index.
--
-- Idempotent: safe to re-run under the CLI or the Supabase MCP.

ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS invoice_sync_due_at timestamptz;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS invoice_sync_lock_until timestamptz;

CREATE INDEX IF NOT EXISTS registrations_invoice_sync_due_idx
  ON public.registrations (invoice_sync_due_at)
  WHERE invoice_sync_due_at IS NOT NULL;
