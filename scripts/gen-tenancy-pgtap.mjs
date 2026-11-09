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
  const inherited = names.filter((n) => registry[n].tenantColumn === 'inherited')

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

  // ── 2. Tenant tables: column, index, RLS ─────────────────────────────────
  // (NOT NULL-readiness is asserted in section 6, after the backfill has run
  // on real rows — the CI database is empty when the migrations apply.)
  lines.push('', '-- 2. Tenant/event tables: tenant_id, an index led by it, RLS.')
  for (const n of [...withColumn, ...inherited]) {
    const [schema, table] = n.split('.')
    t(`SELECT has_column(${lit(schema)}, ${lit(table)}, 'tenant_id', ${lit(`${n} has tenant_id`)});`)
    t(
      `SELECT ok(EXISTS (
  SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
  WHERE i.indrelid = ${lit(n)}::regclass AND a.attname = 'tenant_id'
), ${lit(`${n} has an index led by tenant_id`)});`,
    )
    t(`SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = ${lit(n)}::regclass), ${lit(`${n} has RLS enabled`)});`)
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
  for (const n of inherited) {
    const [schema, table] = n.split('.')
    const { parent, parentKey, noForeignKey } = registry[n]
    const parentName = parent.split('.')[1]
    t(`SELECT col_is_null(${lit(schema)}, ${lit(table)}, 'tenant_id', ${lit(`${n}.tenant_id is nullable: expand only`)});`)
    t(
      `SELECT ok(EXISTS (
  SELECT 1 FROM pg_trigger tg
  WHERE tg.tgrelid = ${lit(n)}::regclass AND tg.tgname = 'zz_tenancy_derive_tenant_id'
    AND tg.tgfoid = 'public.tenancy_inherit_tenant_id()'::regprocedure
    AND tg.tgenabled = 'O'
    AND encode(tg.tgargs, 'escape') = ${lit(`${parentKey}\\000${parentName}\\000`)}
), ${lit(`${n}: inherit trigger on (${parentKey}, ${parentName}), enabled`)});`,
    )
    // PostgREST refuses an unhinted embed once two foreign keys join the same tables.
    t(
      `SELECT is((SELECT count(*)::int FROM pg_constraint c WHERE c.contype = 'f' AND c.conrelid = ${lit(n)}::regclass AND c.confrelid = ${lit(parent)}::regclass),
  ${noForeignKey ? 0 : 1}, ${lit(noForeignKey ? `${n}: no foreign key to ${parent}, so it can outlive its parent` : `${n}: exactly one foreign key to ${parent}, so live embeds stay unambiguous`)});`,
    )
  }

  // ── 3. API roles cannot read the S3 tables ───────────────────────────────
  lines.push('', '-- 3. anon and authenticated cannot read the S3 tables; service_role can.')
  for (const n of S3_PRIVATE_TABLES) {
    t(`SELECT ok(NOT has_table_privilege('anon', ${lit(n)}, 'SELECT'), ${lit(`anon cannot read ${n}`)});`)
    t(`SELECT ok(NOT has_table_privilege('authenticated', ${lit(n)}, 'SELECT'), ${lit(`authenticated cannot read ${n}`)});`)
    t(`SELECT ok(has_table_privilege('service_role', ${lit(n)}, 'SELECT'), ${lit(`service_role can read ${n}`)});`)
  }
  for (const fn of [
    'public.tenancy_derive_tenant_id()',
    'public.tenancy_log_derivation(text, text, text, text)',
    'public.tenancy_backfill_tenant_ids()',
    'public.tenancy_inherit_tenant_id()',
    'public.tenancy_backfill_child_tenant_ids(text[])',
  ]) {
    t(`SELECT ok(NOT has_function_privilege('anon', ${lit(fn)}, 'EXECUTE'), ${lit(`anon cannot execute ${fn}`)});`)
    t(`SELECT ok(NOT has_function_privilege('authenticated', ${lit(fn)}, 'EXECUTE'), ${lit(`authenticated cannot execute ${fn}`)});`)
  }
  // Only the owner runs these: triggers fire without EXECUTE, and the backfill is a migration and a runbook step.
  for (const fn of [
    'public.tenancy_backfill_child_tenant_ids(text[])',
    'public.tenancy_carry_children()',
    'public.tenancy_hidden_from_tenant_session(uuid, text)',
  ]) {
    for (const role of ['anon', 'authenticated', 'service_role', 'tenant_app']) {
      t(`SELECT ok(NOT has_function_privilege(${lit(role)}, ${lit(fn)}, 'EXECUTE'), ${lit(`${role} cannot execute ${fn}`)});`)
    }
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
    `SELECT ok((SELECT expand_applied_at IS NOT NULL AND expand_applied_at <= now() FROM public.tenancy_settings),
  'the expand migration stamped when it actually ran (the 7-day gate counts from here, not from its version date)');`,
  )
  t(
    `SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
  WHERE i.indrelid = 'public.tenancy_derivation_log'::regclass AND i.indisunique AND a.attname = 'day'
), 'the derivation log is append-only: no unique key per day, so no writer waits on a shared counter row');`,
  )
  t(
    `SELECT ok((SELECT proconfig FROM pg_proc WHERE oid = 'public.tenancy_log_derivation(text, text, text, text)'::regprocedure) @> ARRAY['lock_timeout=250ms'],
  'the log writer caps any lock wait at 250 ms');`,
  )
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
    '-- training_modules stands in for a Sanity-keyed table, so its Stellr-only check is dropped for this',
    '-- rolled-back transaction. community_stellr_only.test.sql proves the check.',
    'ALTER TABLE public.training_modules DROP CONSTRAINT training_modules_stellr_only;',
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
    `(SELECT COALESCE(sum(count), 0)::int FROM public.tenancy_derivation_log WHERE table_name = ${lit(table)} AND reason = ${lit(reason)})`
  const orphans = () =>
    `(SELECT COALESCE(sum(count), 0)::int FROM public.tenancy_derivation_log WHERE reason IN ('no_key', 'no_event', 'mismatch', 'error'))`
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
  writeThenIs(
    `INSERT INTO public.event_manager_assignments (clerk_user_id, event_slug) VALUES ('user_pgtap_8', 'pgtap-no-such-event');
INSERT INTO public.event_manager_assignments (clerk_user_id, event_slug) VALUES ('user_pgtap_9', 'pgtap-no-such-event');`,
    `(SELECT count(*)::int FROM public.tenancy_derivation_log WHERE table_name = 'public.event_manager_assignments' AND reason = 'no_event')`,
    3, 'log mode: each orphan write appends its own row (no shared counter row to lock)',
  )

  // A slug rename in Sanity: the event webhook runs rename_event_slug() before
  // it syncs the mirror, so every repaired row briefly carries a slug the
  // mirror does not know. The rows already have a tenant — not orphans.
  lines.push(`DELETE FROM public.tenancy_derivation_log;
SELECT count(*) FROM public.rename_event_slug('pgtap-event', 'pgtap-event-renamed');`)
  t(`SELECT is(${ema('user_pgtap_1')}, ${AU}, 'slug rename before the mirror sync: the row keeps its tenant');`)
  t(`SELECT is(${orphans()}, 0, 'slug rename before the mirror sync: no orphan is counted (the 7-day window is not reset)');`)
  t(`SELECT ok(${logCount('public.event_manager_assignments', 'kept')} >= 1, 'slug rename before the mirror sync: counted as the informational reason kept');`)

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
  t(
    `SELECT lives_ok(
  $q$SELECT * FROM public.rename_event_slug('pgtap-event-renamed', 'pgtap-event-renamed-2')$q$,
  'enforce mode: a slug rename that reaches rows before the mirror sync is not refused'
);`,
  )
  lines.push("UPDATE public.tenancy_settings SET derivation_mode = 'log';")

  // ── 6. The backfill, on real rows ────────────────────────────────────────
  // The CI database is empty when 20261104140000 runs, so its UPDATE touches
  // nothing there. Recreate the pre-S3 state — rows with a NULL tenant_id,
  // written with the derivation trigger off — and run the migration's own
  // function on them.
  const fixtures = ['event_settings', 'survey_access_log', 'event_manager_assignments', 'training_modules']
  lines.push(
    '',
    '-- 6. The backfill (20261104140000) on rows that predate S3, then NOT NULL-readiness everywhere.',
    ...fixtures.map((f) => `ALTER TABLE public.${f} DISABLE TRIGGER zz_tenancy_derive_tenant_id;`),
    `INSERT INTO public.event_settings (event_slug, updated_at) VALUES ('pgtap-historic', '2026-01-01T00:00:00Z');
INSERT INTO public.event_settings (event_slug, updated_at) VALUES ('pgtap-event', '2026-01-01T00:00:00Z');
INSERT INTO public.survey_access_log (actor, action, event_slug) VALUES ('staff', 'view', 'pgtap-historic');
INSERT INTO public.event_manager_assignments (clerk_user_id, event_slug) VALUES ('user_pgtap_hist', 'pgtap-event');
INSERT INTO public.training_modules (title) VALUES ('PgTap historic module');`,
    ...fixtures.map((f) => `ALTER TABLE public.${f} ENABLE TRIGGER zz_tenancy_derive_tenant_id;`),
    'DELETE FROM public.tenancy_derivation_log;',
  )
  const fixtureNulls = `(SELECT count(*)::int FROM public.event_settings WHERE event_slug IN ('pgtap-historic', 'pgtap-event') AND tenant_id IS NULL)`
  t(`SELECT is(${fixtureNulls}, 2, 'fixture: the pre-S3 rows start with a NULL tenant_id');`)
  lines.push('CREATE TEMP TABLE pgtap_backfill ON COMMIT DROP AS SELECT * FROM public.tenancy_backfill_tenant_ids();')
  t(`SELECT is(${fixtureNulls}, 0, 'backfill: the NULL rows now carry a tenant');`)
  t(
    `SELECT set_eq('SELECT tbl FROM pgtap_backfill', ARRAY[
${derived.map((n) => `    ${lit(n.split('.')[1])}`).join(',\n')}
  ]::text[], 'the backfill finds every derived table from its trigger');`,
  )
  t(`SELECT is((SELECT rows_updated FROM pgtap_backfill WHERE tbl = 'event_settings'), 2::bigint, 'the backfill updated both NULL event_settings rows');`)
  t(`SELECT is((SELECT tenant_id FROM public.event_settings WHERE event_slug = 'pgtap-historic'), ${STELLR}, 'backfill: an event the mirror does not know gets Stellr');`)
  t(`SELECT is((SELECT tenant_id FROM public.event_settings WHERE event_slug = 'pgtap-event'), ${AU}, 'backfill: an event the mirror knows gets its tenant');`)
  t(`SELECT is((SELECT updated_at FROM public.event_settings WHERE event_slug = 'pgtap-historic'), '2026-01-01T00:00:00Z'::timestamptz, 'backfill: updated_at is untouched');`)
  t(`SELECT is((SELECT tenant_id FROM public.survey_access_log WHERE event_slug = 'pgtap-historic'), ${STELLR}, 'backfill: the append-only survey_access_log is backfilled');`)
  t(`SELECT is(${ema('user_pgtap_hist')}, ${AU}, 'backfill: an event_slug row takes the mirror event tenant');`)
  t(`SELECT is(${mod('PgTap historic module')}, ${STELLR}, 'backfill: a row with no event key gets Stellr');`)
  t(`SELECT is((SELECT count(*)::int FROM public.tenancy_derivation_log), 0, 'backfill: nothing is logged (the orphan window is not swamped)');`)
  t(
    `SELECT is((SELECT string_agg(DISTINCT tgenabled::text, '') FROM pg_trigger
  WHERE tgname = 'zz_tenancy_derive_tenant_id' AND tgrelid IN (${fixtures.map((f) => lit(`public.${f}`) + '::regclass').join(', ')})),
  'O', 'backfill: the derivation triggers are enabled again');`,
  )
  t(
    `SELECT throws_ok($q$UPDATE public.survey_access_log SET actor = 'x' WHERE event_slug = 'pgtap-historic'$q$,
  NULL, NULL, 'backfill: survey_access_log still refuses updates afterwards');`,
  )
  t(`SELECT is((SELECT COALESCE(sum(rows_updated), 0)::int FROM public.tenancy_backfill_tenant_ids()), 0, 'backfill: re-running it changes nothing');`)
  for (const n of withColumn) {
    t(`SELECT is((SELECT count(*)::int FROM ${n} WHERE tenant_id IS NULL), 0, ${lit(`${n}: no NULL tenant_id after the backfill (NOT NULL-ready)`)});`)
  }

  // ── 7. Child tables: the tenant comes from the parent (S5 C0b) ───────────────
  const STELLR_LIT = lit(STELLR_TENANT_ID)
  const AU_LIT = "'11111111-1111-4111-8111-111111111111'"
  const REG = (k) => `'22222222-2222-4222-8222-00000000000${k}'`
  const P = (k) => `'33333333-3333-4333-8333-00000000000${k}'`
  const AGR = (k) => `'44444444-4444-4444-8444-00000000000${k}'`
  const CRED = "'55555555-5555-4555-8555-000000000001'"
  const RESP = "'66666666-6666-4666-8666-000000000001'"
  const DIST = "'77777777-7777-4777-8777-000000000001'"
  const DEF = "'88888888-8888-4888-8888-000000000001'"
  const participant = (id, reg, extra = {}) => {
    const cols = {
      // One row per (registration_id, email), so each person needs their own address.
      id, registration_id: reg, first_name: "'Pg'", last_name: "'Tap'", email: `'kid-${id.slice(-3, -1)}@example.test'`, phone: "'0'",
      date_of_birth: "'2000-01-01'::date", gender: "''", t_shirt_size: "'M'", school_name: "''", age_bracket: "'high_school'", event_role: "'participant'",
      ...extra,
    }
    return `INSERT INTO public.participants (${Object.keys(cols).join(', ')}) VALUES (${Object.values(cols).join(', ')})`
  }
  const pTenant = (id) => `(SELECT tenant_id FROM public.participants WHERE id = ${id})`
  const agreement = (id, slug) =>
    `INSERT INTO public.agreements (id, event_slug, event_title, envelope_id, signer_name, signer_email, minor_name)
  VALUES (${id}, ${lit(slug)}, 'Kids', ${lit(`env-${id.slice(1, 9)}${id.slice(-3, -1)}`)}, 'Pg', 'signer@example.test', 'Tap');`
  lines.push(
    '',
    '-- 7. Child tables take their tenant from the parent row, and a write that omits it keeps working.',
    `INSERT INTO public.events (tenant_id, slug, sanity_id, title, starts_at, time_zone, country, currency, grade_system) VALUES
  (${AU_LIT}, 'pgtap-kids', 'pgtap-kids-sanity', 'Kids', '2040-06-01T00:00:00Z', 'Australia/Sydney', 'AU', 'aud', 'au_years'),
  (${STELLR_LIT}, 'pgtap-kids-stellr', 'pgtap-kids-stellr-sanity', 'Kids', '2040-06-01T00:00:00Z', 'UTC', 'US', 'usd', 'us_grades'),
  (${STELLR_LIT}, 'pgtap-kids-stellr-b', 'pgtap-kids-stellr-b-sanity', 'Kids', '2040-06-01T00:00:00Z', 'UTC', 'US', 'usd', 'us_grades');
INSERT INTO public.registrations (id, event_slug, event_title, type) VALUES
  (${REG(1)}, 'pgtap-kids', 'Kids', 'individual'),
  (${REG(2)}, 'pgtap-kids-stellr', 'Kids', 'individual'),
  (${REG(3)}, 'pgtap-kids-no-mirror', 'Kids', 'individual'),
  (${REG(4)}, 'pgtap-kids', 'Kids', 'individual');
DELETE FROM public.tenancy_derivation_log;`,
  )
  writeThenIs(`${participant(P(1), REG(1))};`, pTenant(P(1)), AU, 'child: a write that omits tenant_id takes the tenant of its parent');
  writeThenIs(`${participant(P(2), REG(2))};`, pTenant(P(2)), STELLR, 'child: a Stellr write that omits tenant_id is stamped Stellr');
  writeThenIs(`${participant(P(3), REG(3))};`, pTenant(P(3)), STELLR, 'child: an unmirrored Stellr event still registers, through its stamped parent')
  t(`SELECT is(${orphans()}, 0, 'child: none of those writes counts as an orphan');`)
  writeThenIs(
    `${participant(P(4), REG(1), { tenant_id: STELLR_LIT })};`,
    pTenant(P(4)), AU, 'log mode: a supplied tenant_id that disagrees with the parent is replaced',
  )
  t(`SELECT is(${logCount('public.participants', 'mismatch')}, 1, 'log mode: the disagreement is counted as mismatch');`)
  writeThenIs(`UPDATE public.participants SET nickname = 'x' WHERE id = ${P(1)};`, pTenant(P(1)), AU, 'child: an update that names neither column leaves the tenant alone')
  writeThenIs(
    `UPDATE public.participants SET registration_id = ${REG(2)} WHERE id = ${P(4)};`,
    pTenant(P(4)), STELLR, 'child: moving to another parent takes that parent\'s tenant',
  )
  t(`SELECT is(${logCount('public.participants', 'mismatch')}, 1, 'child: and that move names no tenant_id, so it is not a mismatch');`)
  t(
    `SELECT throws_ok($q$${participant(P(9), "'22222222-2222-4222-8222-0000000000ff'")}$q$,
  '23503', NULL, 'child: a parent that does not exist is still refused by its foreign key');`,
  )
  lines.push(`DELETE FROM public.tenancy_derivation_log;
ALTER TABLE public.registrations DISABLE TRIGGER zz_tenancy_derive_tenant_id;
INSERT INTO public.registrations (id, event_slug, event_title, type) VALUES (${REG(5)}, 'pgtap-kids-stellr', 'Kids', 'individual');
ALTER TABLE public.registrations ENABLE TRIGGER zz_tenancy_derive_tenant_id;`)
  t(`SELECT lives_ok($q$${participant(P(5), REG(5))}$q$, 'log mode: a parent the backfill has not reached does not block the write');`)
  t(`SELECT is(${pTenant(P(5))}, NULL::uuid, 'log mode: the child stays NULL with its parent');`)
  t(`SELECT is(${logCount('public.participants', 'no_event')}, 1, 'log mode: that write is counted, because enforce would refuse it');`)
  lines.push(`DELETE FROM public.registrations WHERE id = ${REG(5)};`)
  t(`SELECT is((SELECT count(*)::int FROM public.participants WHERE id = ${P(5)}), 0, 'child: deleting the parent still cascades');`)
  t(
    `SELECT lives_ok($q$SELECT * FROM public.rename_event_slug('pgtap-kids-stellr', 'pgtap-kids-stellr-2')$q$,
  'child: a Stellr slug rename goes through with participants on the event');`,
  )
  t(`SELECT is(${pTenant(P(2))}, ${STELLR}, 'child: and they keep their tenant');`)
  lines.push(`-- A parent moved to another tenant takes its children: what the held-back foreign key's ON UPDATE CASCADE would do.
UPDATE public.registrations SET event_slug = 'pgtap-kids' WHERE id = ${REG(3)};`)
  t(`SELECT is((SELECT tenant_id FROM public.registrations WHERE id = ${REG(3)}), ${AU}, 'carry: the parent moved to the event''s tenant');`)
  t(`SELECT is(${pTenant(P(3))}, ${AU}, 'carry: and its child went with it, on a move a BEFORE trigger made');`)
  t(`SELECT is(${logCount('public.participants', 'mismatch')}, 0, 'carry: following the parent is not counted as a mismatch');`)
  lines.push(agreement(AGR(3), 'pgtap-kids'))
  lines.push(`INSERT INTO public.esign_access_log (envelope_row, action, actor_type) VALUES (${AGR(3)}, 'view', 'system');
INSERT INTO public.agreement_recipients (envelope_row, recipient_id, name, email, status) VALUES (${AGR(3)}, 'r1', 'Pg', 'signer@example.test', 'created');
UPDATE public.agreements SET event_slug = 'pgtap-kids-stellr-b' WHERE id = ${AGR(3)};`)
  t(`SELECT is((SELECT tenant_id FROM public.agreement_recipients WHERE envelope_row = ${AGR(3)}), ${STELLR}, 'carry: agreement_recipients follows its agreement');`)
  t(`SELECT is((SELECT tenant_id FROM public.esign_access_log WHERE envelope_row = ${AGR(3)}), ${STELLR}, 'carry: so does the access log');`)
  lines.push(`SELECT public.esign_append_audit(${AGR(3)}, NULL, 'issued', NULL, NULL, '{}'::jsonb);`)
  t(
    `SELECT throws_ok($q$UPDATE public.agreements SET event_slug = 'pgtap-kids' WHERE id = ${AGR(3)}$q$,
  NULL, NULL, 'carry: an agreement with an audit trail cannot change tenant, because the trail is append-only');`,
  )
  t(`SELECT is((SELECT tenant_id FROM public.agreements WHERE id = ${AGR(3)}), ${STELLR}, 'carry: and the refused move left the agreement where it was');`)
  t(
    `SELECT lives_ok($q$UPDATE public.agreements SET event_title = 'Kids 2' WHERE id = ${AGR(3)}$q$,
  'carry: an update that keeps the tenant is untouched, audit trail or not');`,
  )
  t(
    `SELECT ok((SELECT count(*) = 7 AND bool_and(NOT tgisinternal AND tgenabled = 'O') FROM pg_trigger
  WHERE tgname = 'zzz_tenancy_carry_children' AND tgfoid = 'public.tenancy_carry_children()'::regprocedure),
  'carry: the seven parents each have the trigger');`,
  )

  // The two esign logs: no foreign key, so a row outlives its agreement.
  lines.push(agreement(AGR(1), 'pgtap-kids'))
  lines.push(`INSERT INTO public.esign_access_log (envelope_row, action, actor_type) VALUES (${AGR(1)}, 'view', 'system');
SELECT public.esign_append_audit(${AGR(1)}, NULL, 'issued', NULL, NULL, '{}'::jsonb);`)
  t(`SELECT is((SELECT tenant_id FROM public.esign_access_log WHERE envelope_row = ${AGR(1)}), ${AU}, 'esign: the access log takes the tenant of its agreement');`)
  t(`SELECT is((SELECT tenant_id FROM public.esign_audit_events WHERE envelope_row = ${AGR(1)}), ${AU}, 'esign: the audit trail takes the tenant of its agreement');`)
  t(`SELECT is(public.esign_verify_audit(${AGR(1)}), NULL::bigint, 'esign: the chain verifies with tenant_id on the row, which the hash does not cover');`)
  lines.push(`DELETE FROM public.agreements WHERE id = ${AGR(1)};`)
  t(`SELECT is((SELECT count(*)::int FROM public.esign_access_log WHERE envelope_row = ${AGR(1)} AND tenant_id = ${AU}), 1, 'esign: the access log outlives the agreement and keeps its tenant');`)
  t(`SELECT is((SELECT count(*)::int FROM public.esign_audit_events WHERE envelope_row = ${AGR(1)} AND tenant_id = ${AU}), 1, 'esign: so does the audit trail');`)
  lines.push(`DELETE FROM public.tenancy_derivation_log;
INSERT INTO public.esign_access_log (envelope_row, action, actor_type) VALUES ('44444444-4444-4444-8444-0000000000ff', 'view', 'system');`)
  t(`SELECT is(${logCount('public.esign_access_log', 'no_event')}, 1, 'log mode: an access-log row with no agreement is written and counted');`)

  lines.push('', "UPDATE public.tenancy_settings SET derivation_mode = 'enforce';")
  writeThenIs(`${participant(P(6), REG(4))};`, pTenant(P(6)), AU, 'enforce mode: a write that omits tenant_id still derives')
  t(
    `SELECT throws_ok($q$${participant(P(7), REG(4), { tenant_id: STELLR_LIT })}$q$,
  '23514', NULL, 'enforce mode: a tenant_id that disagrees with the parent is refused');`,
  )
  t(
    `SELECT throws_ok($q$INSERT INTO public.esign_access_log (envelope_row, action, actor_type) VALUES ('44444444-4444-4444-8444-0000000000fe', 'view', 'system')$q$,
  '23503', NULL, 'enforce mode: no parent and no tenant_id is refused');`,
  )
  lines.push("UPDATE public.tenancy_settings SET derivation_mode = 'log';")

  // The backfill, on rows written with the trigger off, the way they predate step 1.
  const backfilled = ['participants', 'credential_events', 'survey_invitations', 'survey_answers', 'esign_audit_events', 'esign_access_log']
  lines.push(
    agreement(AGR(2), 'pgtap-kids'),
    `INSERT INTO public.credentials (id, number, source, recipient_name, title, event_slug) VALUES (${CRED}, 'PGTAP-1', 'manual', 'Pg', 'Tap', 'pgtap-kids');
INSERT INTO public.survey_definitions (id, key, version, title, definition, definition_sha256) VALUES (${DEF}, 'pgtap_child', 1, 'Pg', '{}'::jsonb, repeat('0', 64));
INSERT INTO public.survey_distributions (id, definition_id, event_slug, event_date, event_time_zone, opens_at, closes_at)
  VALUES (${DIST}, ${DEF}, 'pgtap-kids', '2040-06-01'::date, 'UTC', '2040-06-02T00:00:00Z', '2040-06-20T00:00:00Z');
INSERT INTO public.survey_responses (id, definition_id, event_slug, source, legacy_ref) VALUES (${RESP}, ${DEF}, 'pgtap-kids', 'legacy_import', 'pgtap-child');`,
    ...backfilled.map((f) => `ALTER TABLE public.${f} DISABLE TRIGGER zz_tenancy_derive_tenant_id;`),
    `${participant(P(8), REG(1))};
INSERT INTO public.credential_events (credential_id, kind) VALUES (${CRED}, 'view');
INSERT INTO public.survey_invitations (distribution_id, recipient_key, respondent_role, email, token_hash, updated_at)
  VALUES (${DIST}, 'email:pgtap@example.test', 'student', 'pgtap@example.test', 'pgtap-child-hash', '2026-01-01T00:00:00Z');
INSERT INTO public.survey_answers (response_id, question_key, value_text) VALUES (${RESP}, 'q1', 'kept');
INSERT INTO public.esign_audit_events (envelope_row, event, hash) VALUES (${AGR(2)}, 'issued', 'pgtap-hash');
INSERT INTO public.esign_access_log (envelope_row, action, actor_type) VALUES (${AGR(2)}, 'view', 'system');
INSERT INTO public.esign_access_log (envelope_row, action, actor_type) VALUES ('44444444-4444-4444-8444-0000000000fd', 'view', 'system');`,
    ...backfilled.map((f) => `ALTER TABLE public.${f} ENABLE TRIGGER zz_tenancy_derive_tenant_id;`),
    'DELETE FROM public.tenancy_derivation_log;',
  )
  const nullCount = backfilled.map((f) => `(SELECT count(*)::int FROM public.${f} WHERE tenant_id IS NULL)`).join(' + ')
  t(`SELECT is(${nullCount}, 7, 'fixture: the rows that predate the column start with a NULL tenant_id');`)
  lines.push(
    'ALTER TABLE public.survey_invitations DISABLE TRIGGER survey_invitations_updated_at;',
    'ALTER TABLE public.esign_audit_events DISABLE TRIGGER esign_audit_events_guard;',
    `CREATE TEMP TABLE pgtap_child_backfill ON COMMIT DROP AS SELECT * FROM public.tenancy_backfill_child_tenant_ids(ARRAY[
${inherited.map((n) => `  ${lit(n.split('.')[1])}`).join(',\n')}
]);`,
    'ALTER TABLE public.esign_audit_events ENABLE TRIGGER esign_audit_events_guard;',
    'ALTER TABLE public.survey_invitations ENABLE TRIGGER survey_invitations_updated_at;',
  )
  t(
    `SELECT set_eq('SELECT tbl FROM pgtap_child_backfill', ARRAY[
${inherited.map((n) => `    ${lit(n.split('.')[1])}`).join(',\n')}
  ]::text[], 'the child backfill finds every inherited table from its trigger, and no derived one');`,
  )
  t(`SELECT is(${nullCount}, 0, 'child backfill: the NULL rows now carry a tenant');`)
  t(`SELECT is(${pTenant(P(8))}, ${AU}, 'child backfill: a row takes the tenant of its parent');`)
  t(`SELECT is((SELECT tenant_id FROM public.credential_events WHERE credential_id = ${CRED}), ${AU}, 'child backfill: credential_events');`)
  t(`SELECT is((SELECT tenant_id FROM public.survey_answers WHERE response_id = ${RESP}), ${AU}, 'child backfill: survey_answers, through its own redaction flag');`)
  t(`SELECT is((SELECT value_text FROM public.survey_answers WHERE response_id = ${RESP}), 'kept', 'child backfill: the answer itself is untouched');`)
  t(`SELECT is((SELECT updated_at FROM public.survey_invitations WHERE distribution_id = ${DIST}), '2026-01-01T00:00:00Z'::timestamptz, 'child backfill: survey_invitations.updated_at is untouched');`)
  t(`SELECT is((SELECT tenant_id FROM public.esign_audit_events WHERE envelope_row = ${AGR(2)}), ${AU}, 'child backfill: the append-only audit trail');`)
  t(`SELECT is((SELECT tenant_id FROM public.esign_access_log WHERE envelope_row = '44444444-4444-4444-8444-0000000000fd'), ${STELLR}, 'child backfill: a log row whose agreement is gone gets Stellr');`)
  t(`SELECT is((SELECT count(*)::int FROM public.tenancy_derivation_log), 0, 'child backfill: nothing is logged');`)
  t(
    `SELECT is((SELECT string_agg(tgenabled::text, '' ORDER BY tgname) FROM pg_trigger
  WHERE (tgrelid = 'public.esign_audit_events'::regclass AND tgname = 'esign_audit_events_guard')
     OR (tgrelid = 'public.survey_invitations'::regclass AND tgname = 'survey_invitations_updated_at')), 'OO',
  'child backfill: the two triggers switched off for it are on again');`,
  )
  t(`SELECT ok(COALESCE(current_setting('stellr.survey_redaction', true), '') <> 'on', 'child backfill: the redaction flag is off again');`)
  t(`SELECT throws_ok($q$UPDATE public.survey_answers SET value_text = 'x' WHERE response_id = ${RESP}$q$, NULL, NULL, 'child backfill: survey_answers still refuses updates afterwards');`)
  t(`SELECT throws_ok($q$UPDATE public.esign_audit_events SET hash = 'x' WHERE envelope_row = ${AGR(2)}$q$, NULL, NULL, 'child backfill: esign_audit_events still refuses updates afterwards');`)
  t(`SELECT is((SELECT COALESCE(sum(rows_updated), 0)::int FROM public.tenancy_backfill_child_tenant_ids(ARRAY['participants', 'credential_events', 'survey_answers'])), 0, 'child backfill: re-running it changes nothing');`)
  for (const n of inherited) {
    t(`SELECT is((SELECT count(*)::int FROM ${n} WHERE tenant_id IS NULL), 0, ${lit(`${n}: no NULL tenant_id after the backfill (NOT NULL-ready)`)});`)
  }

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
