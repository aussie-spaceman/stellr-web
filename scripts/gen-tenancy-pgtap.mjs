/**
 * gen-tenancy-pgtap.mjs — generate supabase/tests/database/tenancy.test.sql
 * from lib/tenancy/registry.ts (multi-tenancy plan S3: "generated pgTAP").
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/gen-tenancy-pgtap.mjs          # write
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/gen-tenancy-pgtap.mjs --check  # exit 1 if stale
 *
 * lib/tenancy/registry.test.ts fails when the checked-in file is not what this
 * script would write, so a registry change regenerates the database test in
 * the same PR. The CI `db` job runs the file against an ephemeral database
 * built from supabase/baseline.sql + every timestamped migration.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { TABLE_REGISTRY } from '../lib/tenancy/registry.ts'
import { STELLR_TENANT_ID } from '../lib/tenancy/constants.ts'

export const OUTPUT = 'supabase/tests/database/tenancy.test.sql'

/** The S3 tables no API role may read. */
export const S3_PRIVATE_TABLES = [
  'public.tenants',
  'public.tenant_domains',
  'public.tenant_memberships',
  'public.platform_admins',
  'public.events',
  'public.tenancy_settings',
  'public.tenancy_derivation_log',
]

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`

export function generate(registry = TABLE_REGISTRY) {
  const names = Object.keys(registry).sort()
  const withColumn = names.filter((n) => ['own', 'derived'].includes(registry[n].tenantColumn))
  const derived = names.filter((n) => registry[n].tenantColumn === 'derived')
  const own = names.filter((n) => registry[n].tenantColumn === 'own')

  const lines = []
  let tests = 0
  const t = (sql, n = 1) => {
    lines.push(sql)
    tests += n
  }

  // ── 1. Every table classified ────────────────────────────────────────────
  lines.push('-- 1. Every table in public and entitlements is classified, and nothing else is.')
  t(
    `SELECT set_eq(
  $q$SELECT schemaname || '.' || tablename FROM pg_tables WHERE schemaname IN ('public', 'entitlements')$q$,
  ARRAY[
${names.map((n) => `    ${lit(n)}`).join(',\n')}
  ]::text[],
  'every public/entitlements table is classified in lib/tenancy/registry.ts'
);`,
  )

  // ── 2. Tenant tables: column, index, RLS, NOT NULL-ready ─────────────────
  lines.push('', '-- 2. Tenant/event tables: tenant_id, an index led by it, RLS, and no NULLs left.')
  for (const n of withColumn) {
    const [schema, table] = n.split('.')
    t(`SELECT has_column(${lit(schema)}, ${lit(table)}, 'tenant_id', ${lit(`${n} has tenant_id`)});`)
    t(
      `SELECT ok(EXISTS (
  SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
  WHERE i.indrelid = ${lit(n)}::regclass AND a.attname = 'tenant_id'
), ${lit(`${n} has an index led by tenant_id`)});`,
    )
    t(`SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = ${lit(n)}::regclass), ${lit(`${n} has RLS enabled`)});`)
    t(`SELECT is((SELECT count(*)::int FROM ${n} WHERE tenant_id IS NULL), 0, ${lit(`${n}: no NULL tenant_id (NOT NULL-ready)`)});`)
  }
  for (const n of own) {
    const [schema, table] = n.split('.')
    t(`SELECT col_not_null(${lit(schema)}, ${lit(table)}, 'tenant_id', ${lit(`${n}.tenant_id is NOT NULL`)});`)
  }
  for (const n of derived) {
    const { column, kind } = registry[n].eventKey
    t(
      `SELECT ok(EXISTS (
  SELECT 1 FROM pg_trigger tg
  WHERE tg.tgrelid = ${lit(n)}::regclass AND tg.tgname = 'zz_tenancy_derive_tenant_id'
    AND tg.tgfoid = 'public.tenancy_derive_tenant_id()'::regprocedure
    AND tg.tgenabled = 'O'
    AND encode(tg.tgargs, 'escape') = ${lit(`${column}\\000${kind}\\000`)}
), ${lit(`${n}: derivation trigger on (${column}, ${kind}), enabled`)});`,
    )
  }

  // ── 3. API roles cannot read the S3 tables ───────────────────────────────
  lines.push('', '-- 3. anon and authenticated cannot read the S3 tables; service_role can.')
  for (const n of S3_PRIVATE_TABLES) {
    t(`SELECT ok(NOT has_table_privilege('anon', ${lit(n)}, 'SELECT'), ${lit(`anon cannot read ${n}`)});`)
    t(`SELECT ok(NOT has_table_privilege('authenticated', ${lit(n)}, 'SELECT'), ${lit(`authenticated cannot read ${n}`)});`)
    t(`SELECT ok(has_table_privilege('service_role', ${lit(n)}, 'SELECT'), ${lit(`service_role can read ${n}`)});`)
  }
  for (const fn of ['public.tenancy_derive_tenant_id()', 'public.tenancy_log_derivation(text, text, text, text)']) {
    t(`SELECT ok(NOT has_function_privilege('anon', ${lit(fn)}, 'EXECUTE'), ${lit(`anon cannot execute ${fn}`)});`)
    t(`SELECT ok(NOT has_function_privilege('authenticated', ${lit(fn)}, 'EXECUTE'), ${lit(`authenticated cannot execute ${fn}`)});`)
  }

  // ── 4. Seed and constraints ──────────────────────────────────────────────
  lines.push('', '-- 4. Stellr is tenant #1 and the platform owner; the 14+ rule holds for everyone else.')
  t(
    `SELECT is(
  (SELECT slug || '|' || is_platform_owner::text || '|' || currency FROM public.tenants WHERE id = ${lit(STELLR_TENANT_ID)}),
  'stellr|true|usd',
  'Stellr is seeded with the fixed tenant id as platform owner'
);`,
  )
  t(`SELECT is((SELECT derivation_mode FROM public.tenancy_settings), 'log', 'derivation starts in log mode');`)
  t(
    `SELECT throws_ok(
  $q$INSERT INTO public.tenants (slug, legal_name, display_name, country, payment_region, currency, time_zone, min_participant_age)
     VALUES ('pgtap-young', 'Young Ltd', 'Young', 'AU', 'AU', 'aud', 'Australia/Sydney', 13)$q$,
  '23514', NULL, 'a tenant that is not the platform owner cannot admit under-14s'
);`,
  )
  t(
    `SELECT throws_ok(
  $q$INSERT INTO public.tenants (slug, legal_name, display_name, country, payment_region, currency, time_zone)
     VALUES ('pgtap-mixed', 'Mixed Ltd', 'Mixed', 'AU', 'AU', 'usd', 'Australia/Sydney')$q$,
  '23514', NULL, 'an AU tenant cannot settle in USD'
);`,
  )
  t(
    `SELECT throws_ok(
  $q$INSERT INTO public.tenants (slug, legal_name, display_name, country, payment_region, currency, time_zone, is_platform_owner)
     VALUES ('pgtap-owner2', 'Owner Two', 'Owner Two', 'US', 'US', 'usd', 'America/Denver', true)$q$,
  '23505', NULL, 'there is only one platform owner'
);`,
  )
  t(
    `SELECT is(
  (SELECT tgenabled::text FROM pg_trigger WHERE tgrelid = 'public.survey_access_log'::regclass AND tgname = 'survey_access_log_append_only'),
  'O', 'the backfill left survey_access_log append-only'
);`,
  )

  // ── 5. Trigger behaviour ─────────────────────────────────────────────────
  lines.push(
    '',
    '-- 5. The trigger derives tenant_id from public.events, and in log mode never blocks.',
    `INSERT INTO public.tenants (id, slug, legal_name, display_name, country, payment_region, currency, time_zone)
  VALUES ('11111111-1111-4111-8111-111111111111', 'pgtap-au', 'PgTap Pty Ltd', 'PgTap', 'AU', 'AU', 'aud', 'Australia/Sydney');
INSERT INTO public.events (tenant_id, slug, sanity_id, title, time_zone, country, currency, grade_system)
  VALUES ('11111111-1111-4111-8111-111111111111', 'pgtap-event', 'pgtap-sanity-id', 'PgTap Event', 'Australia/Sydney', 'AU', 'aud', 'au_years');
DELETE FROM public.tenancy_derivation_log;`,
  )
  const AU = "'11111111-1111-4111-8111-111111111111'::uuid"
  const STELLR = `${lit(STELLR_TENANT_ID)}::uuid`
  const ema = (user) =>
    `(SELECT tenant_id FROM public.event_manager_assignments WHERE clerk_user_id = ${lit(user)})`
  const mod = (title) => `(SELECT tenant_id FROM public.training_modules WHERE title = ${lit(title)})`
  const logCount = (table, reason) =>
    `(SELECT count::int FROM public.tenancy_derivation_log WHERE table_name = ${lit(table)} AND reason = ${lit(reason)})`
  // A write, then one assertion on its result (pgTAP cannot nest a data-modifying CTE).
  const writeThenIs = (write, got, want, desc) => {
    lines.push(write)
    t(`SELECT is(${got}, ${want}, ${lit(desc)});`)
  }

  writeThenIs(
    "INSERT INTO public.event_manager_assignments (clerk_user_id, event_slug) VALUES ('user_pgtap_1', 'pgtap-event');",
    ema('user_pgtap_1'), AU, 'log mode: tenant_id is derived from the event slug',
  )
  writeThenIs(
    "INSERT INTO public.event_manager_assignments (clerk_user_id, event_slug) VALUES ('user_pgtap_2', 'pgtap-no-such-event');",
    ema('user_pgtap_2'), STELLR, 'log mode: an unknown event slug falls back to Stellr and does not block',
  )
  t(`SELECT is(${logCount('public.event_manager_assignments', 'no_event')}, 1, 'log mode: the unknown slug is counted as no_event');`)
  writeThenIs(
    `INSERT INTO public.event_manager_assignments (clerk_user_id, event_slug, tenant_id) VALUES ('user_pgtap_3', 'pgtap-event', ${lit(STELLR_TENANT_ID)});`,
    ema('user_pgtap_3'), AU, 'log mode: a supplied tenant_id that disagrees with the event is replaced by the derived one',
  )
  t(`SELECT is(${logCount('public.event_manager_assignments', 'mismatch')}, 1, 'log mode: the disagreement is counted as mismatch');`)
  writeThenIs(
    "UPDATE public.event_manager_assignments SET event_slug = 'pgtap-event' WHERE clerk_user_id = 'user_pgtap_2';",
    ema('user_pgtap_2'), AU, 'log mode: changing the event slug re-derives tenant_id',
  )
  writeThenIs(
    "INSERT INTO public.training_modules (title, event_ref) VALUES ('PgTap module', 'pgtap-sanity-id');",
    mod('PgTap module'), AU, 'log mode: tenant_id is derived from a Sanity event _id',
  )
  writeThenIs(
    "INSERT INTO public.training_modules (title) VALUES ('PgTap academy module');",
    mod('PgTap academy module'), STELLR, 'log mode: a row with no event key falls back to Stellr',
  )
  t(`SELECT is(${logCount('public.training_modules', 'no_key')}, 1, 'log mode: the missing key is counted as no_key');`)
  lines.push(`SELECT set_config('stellr.tenancy_backfill', 'on', true);
INSERT INTO public.event_manager_assignments (clerk_user_id, event_slug) VALUES ('user_pgtap_4', 'pgtap-no-such-event');
SELECT set_config('stellr.tenancy_backfill', '', true);`)
  t(`SELECT is(${logCount('public.event_manager_assignments', 'no_event')}, 1, 'backfill flag: writes during the backfill are not counted');`)

  lines.push('', "UPDATE public.tenancy_settings SET derivation_mode = 'enforce';")
  t(
    `SELECT throws_ok(
  $q$INSERT INTO public.event_manager_assignments (clerk_user_id, event_slug) VALUES ('user_pgtap_5', 'pgtap-no-such-event')$q$,
  '23503', NULL, 'enforce mode: an unknown event with no tenant_id is refused'
);`,
  )
  t(
    `SELECT throws_ok(
  $q$INSERT INTO public.event_manager_assignments (clerk_user_id, event_slug, tenant_id)
     VALUES ('user_pgtap_6', 'pgtap-event', ${lit(STELLR_TENANT_ID)})$q$,
  '23514', NULL, 'enforce mode: a tenant_id that disagrees with the event is refused'
);`,
  )
  writeThenIs(
    "INSERT INTO public.event_manager_assignments (clerk_user_id, event_slug) VALUES ('user_pgtap_7', 'pgtap-event');",
    ema('user_pgtap_7'), AU, 'enforce mode: a known event still derives',
  )
  t(
    `SELECT throws_ok(
  $q$INSERT INTO public.training_modules (title) VALUES ('PgTap keyless')$q$,
  '23502', NULL, 'enforce mode: no event key and no tenant_id is refused'
);`,
  )
  lines.push("UPDATE public.tenancy_settings SET derivation_mode = 'log';")

  const header = `-- GENERATED by scripts/gen-tenancy-pgtap.mjs from lib/tenancy/registry.ts.
-- Do not edit by hand: change the registry and regenerate
--   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/gen-tenancy-pgtap.mjs
-- lib/tenancy/registry.test.ts fails while this file is stale.
--
-- pgTAP: the S3 tenancy model (multi-tenancy plan). Runs in the CI \`db\` job
-- against a database built from supabase/baseline.sql + every timestamped
-- migration. Everything rolls back.
BEGIN;
SET LOCAL search_path = extensions, public;

SELECT plan(${tests});
`
  return `${header}\n${lines.join('\n')}\n\nSELECT * FROM finish();\nROLLBACK;\n`
}

function main() {
  const out = generate()
  if (process.argv.includes('--check')) {
    let current = ''
    try {
      current = readFileSync(OUTPUT, 'utf8')
    } catch {}
    if (current !== out) {
      console.error(`✗ ${OUTPUT} is stale — run scripts/gen-tenancy-pgtap.mjs`)
      process.exit(1)
    }
    console.log(`✓ ${OUTPUT} is up to date`)
    return
  }
  writeFileSync(OUTPUT, out)
  console.log(`wrote ${OUTPUT}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
