-- S3 tenancy: the enforce cut-over gate (docs/TENANCY-S3.md, "Enforce cut-over").
-- Read-only. Run by hand in the SQL editor (dev first, then production). Not
-- pgTAP — kept out of supabase/tests/database/ so the CI db job skips it.
--
-- The cut-over may proceed only when ALL of these hold:
--   A. the mode is still 'log' (nobody flipped it early);
--   B. no orphan reasons (no_event / mismatch / error) on any of the last 7 UTC days
--      — exactly the writes enforce would have refused ('kept' is informational);
--   C. at least 7 days of log mode since the expand migration ACTUALLY RAN
--      (tenancy_settings.expand_applied_at, stamped by the migration itself —
--      not the version date, which says nothing about when it was applied),
--      and since the settings row last changed;
--   D. 0 rows with a NULL tenant_id in any of the 32 derived tables. In log
--      mode the trigger always writes a value, so D does not prove derivation:
--      it proves the backfill finished and no write bypassed the trigger
--      (trigger disabled, session_replication_role = replica);
--   E. every event slug used by rows written in the last 7 days is in the mirror;
--   F. no_key counts reviewed per table — enforce REFUSES these writes, so each
--      table listed needs an explicit tenant_id from the app first (S5);
--   G. positive evidence of traffic: rows written in the window whose tenant_id
--      equals their event's tenant in the mirror (derived, not defaulted);
--   H. data-level check, independent of the log: per table, rows whose event
--      key the mirror does not know, and rows whose tenant_id disagrees with
--      their event's tenant (mismatch must be 0).

-- A. Mode
SELECT derivation_mode, updated_at, note FROM public.tenancy_settings;

-- B. Orphans in the last 7 days (must return no rows). The log is append-only
-- (one row per write), so sum(count).
SELECT table_name, reason, sum(count) AS rows, max(sample_key) AS sample_key, max(sqlstate) AS sqlstate
FROM public.tenancy_derivation_log
WHERE reason IN ('no_event', 'mismatch', 'error')
  AND day >= (now() AT TIME ZONE 'UTC')::date - 6
GROUP BY 1, 2
ORDER BY 3 DESC;

-- C. Days of log mode since the expand migration actually ran (ok must be true).
-- A NULL expand_applied_at means the expand migration has not run: not ok.
SELECT expand_applied_at,
       updated_at AS settings_changed_at,
       now() - greatest(expand_applied_at, updated_at) AS log_window,
       COALESCE(derivation_mode = 'log'
                AND now() - greatest(expand_applied_at, updated_at) >= interval '7 days', false) AS ok
FROM public.tenancy_settings;

-- D. NULL tenant_id per derived table (every count must be 0). Backfill
-- complete and no trigger bypass — NOT a proof of derivation (see G and H).
SELECT t.tbl, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I WHERE tenant_id IS NULL', t.tbl), false, true, '')))[1]::text::bigint AS null_tenant_rows
FROM (VALUES
  ('agreements'), ('community_resources'), ('community_spaces'), ('credentials'), ('event_award_assignments'),
  ('event_badge_templates'), ('event_certificate_templates'), ('event_companies'), ('event_email_sends'), ('event_emails'),
  ('event_manager_assignments'), ('event_participations'), ('event_refunds'), ('event_settings'), ('event_store_offerings'),
  ('group_invoices'), ('group_join_tokens'), ('member_groups'), ('mentoring_cohorts'), ('merch_batches'),
  ('refund_policies'), ('registrations'), ('scholarship_applications'), ('store_event_discounts'), ('store_orders'),
  ('survey_access_log'), ('survey_distributions'), ('survey_responses'), ('team_profiles'), ('training_assignments'),
  ('training_modules'), ('volunteer_event_interest')
) AS t(tbl)
ORDER BY 2 DESC, 1;

-- E. Event keys used by rows written in the last 7 days that the mirror does not know (must return no rows)
SELECT 'registrations' AS tbl, r.event_slug AS key, count(*) AS rows
FROM public.registrations r LEFT JOIN public.events e ON e.slug = r.event_slug
WHERE e.id IS NULL AND r.created_at > now() - interval '7 days'
GROUP BY 1, 2
UNION ALL
SELECT 'agreements', a.event_slug, count(*)
FROM public.agreements a LEFT JOIN public.events e ON e.slug = a.event_slug
WHERE a.event_slug IS NOT NULL AND e.id IS NULL AND a.created_at > now() - interval '7 days'
GROUP BY 1, 2
UNION ALL
SELECT 'event_participations', p.event_slug, count(*)
FROM public.event_participations p LEFT JOIN public.events e ON e.slug = p.event_slug
WHERE p.event_slug IS NOT NULL AND e.id IS NULL AND p.created_at > now() - interval '7 days'
GROUP BY 1, 2
ORDER BY 3 DESC;

-- F. no_key by table, last 7 days (review: expected only where the event is optional)
SELECT table_name, sum(count) AS rows
FROM public.tenancy_derivation_log
WHERE reason = 'no_key' AND day >= (now() AT TIME ZONE 'UTC')::date - 6
GROUP BY 1
ORDER BY 2 DESC;

-- G. Traffic in the window, derived from the mirror (review: registrations and
-- agreements must show derived_rows > 0 on production; written_rows = derived_rows).
SELECT 'registrations' AS tbl, count(*) AS written_rows,
       count(*) FILTER (WHERE r.tenant_id = e.tenant_id) AS derived_rows
FROM public.registrations r LEFT JOIN public.events e ON e.slug = r.event_slug
WHERE r.created_at > now() - interval '7 days'
UNION ALL
SELECT 'agreements', count(*), count(*) FILTER (WHERE a.tenant_id = e.tenant_id)
FROM public.agreements a LEFT JOIN public.events e ON e.slug = a.event_slug
WHERE a.event_slug IS NOT NULL AND a.created_at > now() - interval '7 days'
UNION ALL
SELECT 'event_participations', count(*), count(*) FILTER (WHERE p.tenant_id = e.tenant_id)
FROM public.event_participations p LEFT JOIN public.events e ON e.slug = p.event_slug
WHERE p.event_slug IS NOT NULL AND p.created_at > now() - interval '7 days';

-- H. Every derived table, all rows: event keys the mirror does not know, and
-- tenant_id disagreeing with the event's tenant. mismatch_rows must be 0.
-- unknown_key_rows on historic rows (events deleted from Sanity) do not block
-- enforce — it only checks writes — but each one must be explained.
SELECT t.tbl,
       (xpath('/row/c/text()', query_to_xml(format(
         'SELECT count(*) AS c FROM public.%I x WHERE x.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.events e WHERE e.%I = x.%I)',
         t.tbl, t.col, t.ecol, t.col), false, true, '')))[1]::text::bigint AS unknown_key_rows,
       (xpath('/row/c/text()', query_to_xml(format(
         'SELECT count(*) AS c FROM public.%I x JOIN public.events e ON e.%I = x.%I WHERE x.tenant_id IS DISTINCT FROM e.tenant_id',
         t.tbl, t.ecol, t.col), false, true, '')))[1]::text::bigint AS mismatch_rows
FROM (
  SELECT c.relname::text AS tbl,
         split_part(encode(tg.tgargs, 'escape'), '\000', 1) AS col,
         CASE split_part(encode(tg.tgargs, 'escape'), '\000', 2) WHEN 'sanity_id' THEN 'sanity_id' ELSE 'slug' END AS ecol
  FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
  WHERE tg.tgname = 'zz_tenancy_derive_tenant_id'
) AS t
ORDER BY 3 DESC, 2 DESC, 1;
