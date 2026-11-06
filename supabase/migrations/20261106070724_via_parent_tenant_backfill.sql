-- S5 C0b (docs/TENANCY-S5.md), step 2 of 3: BACKFILL.
--
-- Stamps tenant_id on the rows of the 10 child tables that predate step 1. Only
-- rows with tenant_id IS NULL are touched, so running it again changes nothing.
--
--   A row whose parent has a tenant takes that tenant.
--   A row whose parent has no tenant stays NULL. tenancy_cutover_checks.sql
--     section D2 reports it, and a later run stamps it once the parent has one.
--   A row whose parent is gone takes Stellr's id. Only the two esign logs can be
--     in this state, since every other parent key is a foreign key. Every row in
--     production today is Stellr's, as the S3 backfill also relied on.
--
-- ── Locks ────────────────────────────────────────────────────────────────────
-- No table lock on 8 of the 10. The UPDATE takes row locks until commit, so a live
-- UPDATE of one of those rows waits for the commit. Live inserts do not wait.
--
-- Two tables have a BEFORE UPDATE trigger that this write must not fire, so each is
-- switched off for this one write and back on, as the S3 backfill did:
--   * esign_audit_events_guard, because the table is append-only and the guard
--     makes no exception for an UPDATE. tenant_id is not a content column, and the
--     chain's hash does not cover it;
--   * survey_invitations_updated_at, because a backfill is not an edit.
-- That takes SHARE ROW EXCLUSIVE, which holds up writers of those two tables until
-- commit, so they come last.
--
-- survey_answers uses its own sanctioned route: the function sets the
-- stellr.survey_redaction flag its immutability trigger already honours, for the
-- length of the function only.
--
-- The work is a function so pgTAP can run the same code on real NULL rows: the CI
-- database is empty when this file runs there (tenancy.test.sql, section 7). It
-- reads each table's parent from the trigger's own arguments, so it cannot drift
-- from step 1. SECURITY INVOKER, with EXECUTE revoked from every API role, so only
-- the owner runs it: this file, pgTAP and the tenancy_cutover_checks runbook.
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.tenancy_backfill_child_tenant_ids(p_tables text[])
RETURNS TABLE (tbl text, rows_updated bigint)
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  stellr constant uuid := '00000000-0000-4000-8000-000000000001';
  spec   record;
  n      bigint;
  gone   bigint;
  -- Set in the body, not as a function-level SET: Postgres lets only a superuser
  -- pin an unregistered custom parameter in CREATE FUNCTION.
  prev_quiet     text := current_setting('stellr.tenancy_backfill', true);
  prev_redaction text := current_setting('stellr.survey_redaction', true);
BEGIN
  PERFORM set_config('stellr.tenancy_backfill', 'on', true);
  PERFORM set_config('stellr.survey_redaction', 'on', true);

  FOR spec IN
    SELECT c.relname::text AS rel,
           split_part(encode(t.tgargs, 'escape'), '\000', 1) AS key_col,
           split_part(encode(t.tgargs, 'escape'), '\000', 2) AS parent_tbl
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND t.tgname = 'zz_tenancy_derive_tenant_id'
      AND t.tgfoid = 'public.tenancy_inherit_tenant_id()'::regprocedure
      AND c.relname = ANY (p_tables)
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'UPDATE public.%1$I x SET tenant_id = p.tenant_id FROM public.%2$I p '
      || 'WHERE p.id = x.%3$I AND x.tenant_id IS NULL AND p.tenant_id IS NOT NULL',
      spec.rel, spec.parent_tbl, spec.key_col
    );
    GET DIAGNOSTICS n = ROW_COUNT;

    EXECUTE format(
      'UPDATE public.%1$I x SET tenant_id = %4$L::uuid WHERE x.tenant_id IS NULL '
      || 'AND NOT EXISTS (SELECT 1 FROM public.%2$I p WHERE p.id = x.%3$I)',
      spec.rel, spec.parent_tbl, spec.key_col, stellr
    );
    GET DIAGNOSTICS gone = ROW_COUNT;

    RAISE NOTICE 'tenancy child backfill: public.% - % from the parent, % with no parent', spec.rel, n, gone;
    tbl := spec.rel;
    rows_updated := n + gone;
    RETURN NEXT;
  END LOOP;

  PERFORM set_config('stellr.tenancy_backfill', COALESCE(prev_quiet, ''), true);
  PERFORM set_config('stellr.survey_redaction', COALESCE(prev_redaction, ''), true);
END $fn$;

REVOKE EXECUTE ON FUNCTION public.tenancy_backfill_child_tenant_ids(text[]) FROM PUBLIC, anon, authenticated, service_role;

SELECT tbl, rows_updated FROM public.tenancy_backfill_child_tenant_ids(ARRAY[
  'agreement_recipients', 'credential_events', 'esign_access_log', 'member_group_members', 'participants',
  'store_order_items', 'store_returns', 'survey_answers'
]);

ALTER TABLE public.survey_invitations DISABLE TRIGGER survey_invitations_updated_at;
ALTER TABLE public.esign_audit_events DISABLE TRIGGER esign_audit_events_guard;
SELECT tbl, rows_updated FROM public.tenancy_backfill_child_tenant_ids(ARRAY['esign_audit_events', 'survey_invitations']);
ALTER TABLE public.esign_audit_events ENABLE TRIGGER esign_audit_events_guard;
ALTER TABLE public.survey_invitations ENABLE TRIGGER survey_invitations_updated_at;
