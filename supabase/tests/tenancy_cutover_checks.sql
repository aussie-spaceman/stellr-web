-- S3 tenancy: the enforce cut-over gate (docs/TENANCY-S3.md, "Enforce cut-over").
-- Read-only. Run by hand in the SQL editor (dev first, then production). Not
-- pgTAP — kept out of supabase/tests/database/ so the CI db job skips it.
--
-- The cut-over may proceed only when ALL of these hold:
--   A. the mode is still 'log' (nobody flipped it early);
--   B. no orphan reasons (no_event / mismatch / error) on any of the last 7 UTC days;
--   C. at least 7 distinct days of log-mode operation since the expand migration;
--   D. 0 rows with a NULL tenant_id in any of the 32 derived tables (NOT NULL-ready);
--   E. every event slug referenced by a live table exists in the mirror (0 orphans);
--   F. no_key counts reviewed per table (expected only on optional-event tables).

-- A. Mode
SELECT derivation_mode, updated_at, note FROM public.tenancy_settings;

-- B. Orphans in the last 7 days (must return no rows)
SELECT table_name, reason, sum(count) AS rows, max(sample_key) AS sample_key, max(sqlstate) AS sqlstate
FROM public.tenancy_derivation_log
WHERE reason IN ('no_event', 'mismatch', 'error')
  AND day >= (now() AT TIME ZONE 'UTC')::date - 6
GROUP BY 1, 2
ORDER BY 3 DESC;

-- C. Days since the expand migration was recorded (must be >= 7)
SELECT version, (now()::date - to_date(left(version, 8), 'YYYYMMDD')) AS days_ago
FROM supabase_migrations.schema_migrations
WHERE version = '20261104130000';

-- D. NULL tenant_id per derived table (every count must be 0)
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
