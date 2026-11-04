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

SET LOCAL lock_timeout = '5s';
SET LOCAL stellr.tenancy_backfill = 'on';

DO $$
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
    SELECT * FROM (VALUES
      ('agreements', 'event_slug', 'slug'),
      ('community_resources', 'event_ref', 'sanity_id'),
      ('community_spaces', 'sanity_event_id', 'sanity_id'),
      ('credentials', 'event_slug', 'slug'),
      ('event_award_assignments', 'event_slug', 'slug'),
      ('event_badge_templates', 'event_slug', 'slug'),
      ('event_certificate_templates', 'event_slug', 'slug'),
      ('event_companies', 'event_slug', 'slug'),
      ('event_email_sends', 'event_slug', 'slug'),
      ('event_emails', 'event_slug', 'slug'),
      ('event_manager_assignments', 'event_slug', 'slug'),
      ('event_participations', 'event_slug', 'slug'),
      ('event_refunds', 'event_slug', 'slug'),
      ('event_settings', 'event_slug', 'slug'),
      ('event_store_offerings', 'event_slug', 'slug'),
      ('group_invoices', 'event_slug', 'slug'),
      ('group_join_tokens', 'event_slug', 'slug'),
      ('member_groups', 'event_slug', 'slug'),
      ('mentoring_cohorts', 'sanity_event_id', 'sanity_id'),
      ('merch_batches', 'event_slug', 'slug'),
      ('refund_policies', 'event_slug', 'slug'),
      ('registrations', 'event_slug', 'slug'),
      ('scholarship_applications', 'event_slug', 'slug'),
      ('store_event_discounts', 'event_slug', 'slug'),
      ('store_orders', 'event_slug', 'slug'),
      ('survey_access_log', 'event_slug', 'slug'),
      ('survey_distributions', 'event_slug', 'slug'),
      ('survey_responses', 'event_slug', 'slug'),
      ('team_profiles', 'event_slug', 'slug'),
      ('training_assignments', 'event_ref', 'sanity_id'),
      ('training_modules', 'event_ref', 'sanity_id'),
      ('volunteer_event_interest', 'event_slug', 'slug')
    ) AS t(tbl, key_col, key_kind)
  LOOP
    saved := ARRAY[]::text[];
    modes := ARRAY[]::text[];
    FOR trg IN
      SELECT t.tgname, t.tgenabled
      FROM pg_trigger t
      WHERE t.tgrelid = format('public.%I', spec.tbl)::regclass
        AND NOT t.tgisinternal
        AND t.tgenabled IN ('O', 'A', 'R')
    LOOP
      saved := saved || trg.tgname::text;
      modes := modes || trg.tgenabled::text;
      EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', spec.tbl, trg.tgname);
    END LOOP;

    EXECUTE format(
      'UPDATE public.%1$I x SET tenant_id = COALESCE('
      || '(SELECT e.tenant_id FROM public.events e WHERE e.%2$I = x.%3$I), %4$L::uuid) '
      || 'WHERE x.tenant_id IS NULL',
      spec.tbl,
      CASE spec.key_kind WHEN 'sanity_id' THEN 'sanity_id' ELSE 'slug' END,
      spec.key_col,
      stellr
    );
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'tenancy backfill: public.% — % row(s)', spec.tbl, n;

    FOR i IN 1 .. coalesce(array_length(saved, 1), 0) LOOP
      EXECUTE format(
        'ALTER TABLE public.%I ENABLE %s TRIGGER %I',
        spec.tbl,
        CASE modes[i] WHEN 'A' THEN 'ALWAYS' WHEN 'R' THEN 'REPLICA' ELSE '' END,
        saved[i]
      );
    END LOOP;
  END LOOP;
END $$;
