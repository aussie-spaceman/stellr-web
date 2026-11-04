-- S3 "Tenant and event data model" (multi-tenancy plan), step 5 of 5: BACKFILL.
--
-- Sets tenant_id on every EXISTING row of the 32 tables expanded by
-- 20261104130000_tenant_id_expand.sql. Safe by construction: every row in the
-- database today is Stellr's (tenant #1 is the only tenant), so each row gets
-- its event's tenant from public.events when the mirror already has it, and
-- Stellr's id otherwise — which is the same value.
--
-- Only rows with tenant_id IS NULL are touched; re-running is a no-op.
--
-- The tables' own user triggers are switched off for the UPDATE and restored
-- afterwards, inside this one transaction:
--   * set_updated_at-style triggers would otherwise stamp updated_at on every
--     historic row (a backfill is not an edit);
--   * survey_access_log is append-only by trigger, and survey_responses
--     freezes submitted rows — tenant_id is not a content column, and this is
--     the one sanctioned write to those rows;
--   * the derivation trigger itself would otherwise count every historic row
--     as 'no_event' and swamp the 7-day orphan window.
-- Only triggers that were enabled before are re-enabled, in the mode they had
-- (origin / always / replica), so a trigger someone disabled on purpose stays
-- disabled. Foreign-key (internal) triggers are never touched.
--
-- If the mirror has been backfilled first (scripts/backfill-events-mirror.ts),
-- the lookup uses it; it does not need to be.
--
-- The work is a function, public.tenancy_backfill_tenant_ids(), so the same
-- code the migration runs is exercised by pgTAP against real NULL rows
-- (supabase/tests/database/tenancy.test.sql, section 6) — the CI database is
-- empty when this migration runs there. It finds its tables from the
-- catalog: every table carrying the zz_tenancy_derive_tenant_id trigger, with
-- the event key column and kind read from the trigger's own arguments, so it
-- cannot drift from the expand migration. SECURITY INVOKER: ALTER TABLE …
-- DISABLE TRIGGER needs the table owner, so only the migration role (or the
-- owner in the SQL editor) can run it; EXECUTE is revoked from every API role.

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.tenancy_backfill_tenant_ids()
RETURNS TABLE (tbl text, rows_updated bigint)
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
SET stellr.tenancy_backfill = 'on'
AS $fn$
DECLARE
  stellr constant uuid := '00000000-0000-4000-8000-000000000001';
  spec   record;
  trg    record;
  saved  text[];
  modes  text[];
  i      int;
  n      bigint;
BEGIN
  FOR spec IN
    SELECT c.relname::text AS rel,
           split_part(encode(t.tgargs, 'escape'), '\000', 1) AS key_col,
           COALESCE(NULLIF(split_part(encode(t.tgargs, 'escape'), '\000', 2), ''), 'slug') AS key_kind
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND t.tgname = 'zz_tenancy_derive_tenant_id'
      AND t.tgfoid = 'public.tenancy_derive_tenant_id()'::regprocedure
    ORDER BY c.relname
  LOOP
    saved := ARRAY[]::text[];
    modes := ARRAY[]::text[];
    FOR trg IN
      SELECT t.tgname, t.tgenabled
      FROM pg_trigger t
      WHERE t.tgrelid = format('public.%I', spec.rel)::regclass
        AND NOT t.tgisinternal
        AND t.tgenabled IN ('O', 'A', 'R')
    LOOP
      saved := saved || trg.tgname::text;
      modes := modes || trg.tgenabled::text;
      EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', spec.rel, trg.tgname);
    END LOOP;

    EXECUTE format(
      'UPDATE public.%1$I x SET tenant_id = COALESCE('
      || '(SELECT e.tenant_id FROM public.events e WHERE e.%2$I = x.%3$I), %4$L::uuid) '
      || 'WHERE x.tenant_id IS NULL',
      spec.rel,
      CASE spec.key_kind WHEN 'sanity_id' THEN 'sanity_id' ELSE 'slug' END,
      spec.key_col,
      stellr
    );
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'tenancy backfill: public.% — % row(s)', spec.rel, n;

    FOR i IN 1 .. coalesce(array_length(saved, 1), 0) LOOP
      EXECUTE format(
        'ALTER TABLE public.%I ENABLE %s TRIGGER %I',
        spec.rel,
        CASE modes[i] WHEN 'A' THEN 'ALWAYS' WHEN 'R' THEN 'REPLICA' ELSE '' END,
        saved[i]
      );
    END LOOP;

    tbl := spec.rel;
    rows_updated := n;
    RETURN NEXT;
  END LOOP;
END $fn$;

REVOKE EXECUTE ON FUNCTION public.tenancy_backfill_tenant_ids() FROM PUBLIC, anon, authenticated;

SELECT tbl, rows_updated FROM public.tenancy_backfill_tenant_ids();
