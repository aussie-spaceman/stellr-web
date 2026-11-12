-- S5 wave 7 (O1): what each dev flip reads afterwards. Read-only, and dev only.
--
-- Run with psql against the DEV database, giving the moment the flip's redeploy
-- went READY (recorded in the tracker as :flip_at):
--
--   psql "$DEV_DB_URL" -v flip_at='2026-11-20 14:05:00+00' -f supabase/tests/s5_watch_only.sql
--
-- Not pgTAP and not a migration: it lives outside supabase/tests/database/, so the
-- CI db job skips it. Everything runs inside one READ ONLY transaction that is
-- rolled back. Every check is filtered by last_seen (or its own timestamp) >=
-- :flip_at, because CI e2e writes to the same dev database (docs/TENANCY-S5.md,
-- dev switch sequence).
--
-- Before the flip, confirm it took effect in GET /api/admin/health/integrations
-- (`tenancy`: resolved values, `unrecognised` empty, no `invalidCombinations`).
--
-- The repo is public. Some rows carry members.id or row ids (authz_mismatch,
-- TENANTDB mismatches). The queries below aggregate them away; keep any detail
-- you read off the repo and out of CI logs.

\set ON_ERROR_STOP on
\if :{?flip_at}
\else
  \echo 'Set the flip time: psql -v flip_at=''<timestamptz>'' -f supabase/tests/s5_watch_only.sql'
  \quit
\endif

BEGIN TRANSACTION READ ONLY;

\echo '== Every switch: new app_errors rows since the flip, by kind'
SELECT split_part(route, ' ', 1) AS kind, count(*) AS digests, sum(count) AS occurrences, max(last_seen) AS last_seen
FROM public.app_errors
WHERE last_seen >= :'flip_at'::timestamptz
GROUP BY 1
ORDER BY 3 DESC;

-- ── PLATFORM_AUDIT_ENABLED (P1) ───────────────────────────────────────────────
\echo '== PLATFORM_AUDIT_ENABLED: audit rows by actor kind and action (at least 1 per exercised kind)'
SELECT actor_kind, action, count(*) AS rows
FROM public.platform_audit_events
WHERE occurred_at >= :'flip_at'::timestamptz
GROUP BY 1, 2
ORDER BY 1, 2;

\echo '== PLATFORM_AUDIT_ENABLED: unresolved actors and tenants (both must be 0)'
SELECT count(*) FILTER (WHERE (metadata ->> 'actor_unresolved')::boolean IS TRUE) AS actor_unresolved,
       count(*) FILTER (WHERE (metadata ->> 'tenant_unresolved')::boolean IS TRUE) AS tenant_unresolved
FROM public.platform_audit_events
WHERE occurred_at >= :'flip_at'::timestamptz;

\echo '== PLATFORM_AUDIT_ENABLED: AUDIT rows in app_errors (must be 0)'
SELECT route, count(*) AS digests, sum(count) AS occurrences, max(last_seen) AS last_seen
FROM public.app_errors
WHERE route LIKE 'AUDIT %' AND last_seen >= :'flip_at'::timestamptz
GROUP BY 1
ORDER BY 3 DESC;

-- ── LOADSCOPED_MODE (P2 shadow, P4 enforce) ──────────────────────────────────
\echo '== LOADSCOPED_MODE: shadow rows by route and reason (0 apart from the canary presence control)'
SELECT route,
       coalesce(substring(message FROM 'mismatch: \S+ (\S+)'), 'other') AS reason,
       count(*) AS digests, sum(count) AS occurrences, max(last_seen) AS last_seen
FROM public.app_errors
WHERE route LIKE 'LOADSCOPED %' AND last_seen >= :'flip_at'::timestamptz
GROUP BY 1, 2
ORDER BY 4 DESC;

-- ── AUTHZ_SOURCE (P3) ────────────────────────────────────────────────────────
\echo '== AUTHZ_SOURCE: mismatch, lookup_failed and unrecognised-source rows (members.id aggregated away)'
SELECT route,
       CASE
         WHEN message LIKE 'authz_source_unrecognised%' THEN 'source_unrecognised'
         WHEN message LIKE '% lookup_failed%' THEN 'lookup_failed'
         WHEN message LIKE 'authz_mismatch%' THEN 'mismatch'
         ELSE 'other'
       END AS kind,
       split_part(message, ' ', 2) AS decision,
       count(*) AS members, sum(count) AS occurrences, min(occurred_at) AS first_seen, max(last_seen) AS last_seen
FROM public.app_errors
WHERE route LIKE 'AUTHZ %' AND last_seen >= :'flip_at'::timestamptz
GROUP BY 1, 2, 3
ORDER BY 6 DESC;

-- ── RATE_LIMIT_STORE and RATE_LIMIT_KEY_SECRET (P5) ──────────────────────────
\echo '== RATE_LIMIT_STORE: counter windows opened since the flip (must grow)'
SELECT window_seconds, count(*) AS windows, sum(hits) AS hits
FROM public.rate_limit_hits
WHERE window_start >= :'flip_at'::timestamptz
GROUP BY 1
ORDER BY 1;

\echo '== RATE_LIMIT_STORE: RATELIMIT rows (store problems and disagreements; must be 0)'
SELECT route, message, count(*) AS digests, sum(count) AS occurrences, max(last_seen) AS last_seen
FROM public.app_errors
WHERE route LIKE 'RATELIMIT %' AND last_seen >= :'flip_at'::timestamptz
GROUP BY 1, 2
ORDER BY 4 DESC;

-- ── TENANT_DB_ENABLED and TENANT_DB_AREAS (P7, P8, P9) ───────────────────────
\echo '== TENANT_DB: shadow rows by area and reason (row ids aggregated away; must be 0)'
SELECT route,
       coalesce(substring(message FROM 'area=(\S+)'), '-') AS area,
       coalesce(substring(message FROM 'reason=(\S+)'), 'other') AS reason,
       count(*) AS digests, sum(count) AS occurrences, max(last_seen) AS last_seen
FROM public.app_errors
WHERE (route LIKE 'TENANTDB %' OR route = 'CONFIG TENANT_DB_AREAS') AND last_seen >= :'flip_at'::timestamptz
GROUP BY 1, 2, 3
ORDER BY 5 DESC;

\echo '== TENANT_DB: tenant database connections now (positive signal once an area is listed)'
SELECT usename, state, count(*) AS connections
FROM pg_stat_activity
WHERE application_name = 'stellr-tenantdb'
GROUP BY 1, 2
ORDER BY 1, 2;

\echo '== TENANT_DB: event_companies rows (compare before and after a PUT: no double write)'
SELECT count(*) AS event_companies FROM public.event_companies;

-- ── TENANT_ROUTING_ENABLED and TENANT_HOST_SUFFIX (P10) ──────────────────────
-- Routing writes no rows of its own. Its signal is `tenancy.routing.suffixError`
-- null in the health report, and the spot-checks in the plan. The first query
-- above shows any new app_errors kind.

-- ── TENANT_EVENT_MAIL_ENABLED (P11) ──────────────────────────────────────────
\echo '== TENANT_EVENT_MAIL_ENABLED: tenant mail held by the crons (falls to 0 once on)'
SELECT job, count(*) AS runs,
       sum(coalesce((result ->> 'tenantHeld')::bigint, 0)) AS tenant_held,
       count(*) FILTER (WHERE ok IS FALSE) AS failed_runs
FROM public.cron_runs
WHERE job IN ('event-emails', 'docusign-reminders') AND started_at >= :'flip_at'::timestamptz
GROUP BY 1
ORDER BY 1;

\echo '== TENANT_EVENT_MAIL_ENABLED: outbox by status and reason (counts only; no addresses)'
SELECT status, reason, count(*) AS messages
FROM public.email_outbox
WHERE created_at >= :'flip_at'::timestamptz
GROUP BY 1, 2
ORDER BY 1, 2;

-- ── TENANT_GUARDIAN_CONSENT_ENABLED (P12) ────────────────────────────────────
\echo '== TENANT_GUARDIAN_CONSENT_ENABLED: consent rows by status, requested or settled since the flip'
SELECT status, count(*) AS rows,
       count(*) FILTER (WHERE status = 'pending' AND expires_at < now()) AS pending_past_expiry,
       max(removal_attempts) AS max_removal_attempts
FROM public.tenant_guardian_consents
WHERE requested_at >= :'flip_at'::timestamptz OR settled_at >= :'flip_at'::timestamptz
GROUP BY 1
ORDER BY 1;

\echo '== TENANT_GUARDIAN_CONSENT_ENABLED: consent audit actions'
SELECT action, count(*) AS rows
FROM public.platform_audit_events
WHERE action LIKE 'registration.guardian_consent.%' AND occurred_at >= :'flip_at'::timestamptz
GROUP BY 1
ORDER BY 1;

\echo '== TENANT_GUARDIAN_CONSENT_ENABLED: the expiry cron (its tenant-consent sub-job only on dev)'
SELECT job, count(*) AS runs, count(*) FILTER (WHERE ok IS FALSE) AS failed_runs, max(started_at) AS last_run
FROM public.cron_runs
WHERE job LIKE 'membership-expiry%' AND started_at >= :'flip_at'::timestamptz
GROUP BY 1
ORDER BY 1;

-- ── FIELD_CRYPTO_MODE (not flipped in wave 7) ────────────────────────────────
\echo '== FIELD_CRYPTO_MODE: data keys created since the flip (shadow creates one per tenant on first write)'
SELECT count(*) AS data_keys, count(*) FILTER (WHERE retired_at IS NOT NULL) AS retired
FROM public.tenant_data_keys
WHERE created_at >= :'flip_at'::timestamptz;

-- ── tenancy_settings.derivation_mode (not flipped in wave 7) ─────────────────
\echo '== derivation_mode: the setting, and the derivation log since the flip day (UTC)'
SELECT derivation_mode, updated_at FROM public.tenancy_settings;

SELECT reason, count(DISTINCT table_name) AS tables, sum(count) AS writes
FROM public.tenancy_derivation_log
WHERE day >= (:'flip_at'::timestamptz AT TIME ZONE 'UTC')::date
GROUP BY 1
ORDER BY 1;

ROLLBACK;
