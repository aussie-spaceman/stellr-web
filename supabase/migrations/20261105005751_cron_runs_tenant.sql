-- cron_runs_tenant (S5 B3): lets the ledger hold one child row per tenant under
-- a cron's top-level run, for the per-tenant runner in lib/cron-tenants.ts.
--
-- Additive and nullable, with no backfill. Every existing row and every row the
-- current code writes stays top-level (parent_id NULL, tenant_id NULL), so the
-- code runs the same before and after this is applied. lastCronResult
-- (lib/cron-runs.ts) does not depend on it being applied.
--
-- cron_runs stays a system table: tenant_id only labels a child row. Grants are
-- unchanged (service_role, 20260928180000); tenant_app has none, and
-- tenant_isolation.test.sql asserts that.

ALTER TABLE public.cron_runs
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.cron_runs (id) ON DELETE CASCADE;

-- Partial: top-level runs never need either index, and those are all the rows.
CREATE INDEX IF NOT EXISTS cron_runs_tenant_job_started_idx
  ON public.cron_runs (tenant_id, job, started_at DESC)
  WHERE tenant_id IS NOT NULL;

-- Backs the ON DELETE CASCADE.
CREATE INDEX IF NOT EXISTS cron_runs_parent_idx
  ON public.cron_runs (parent_id)
  WHERE parent_id IS NOT NULL;
