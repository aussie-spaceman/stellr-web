/**
 * gen-tenant-isolation-pgtap.mjs — generate
 * supabase/tests/database/tenant_isolation.test.sql, the cross-tenant matrix
 * (multi-tenancy plan S4 gate "pgTAP cross-tenant matrix"), from
 * lib/tenancy/registry.ts.
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/gen-tenant-isolation-pgtap.mjs          # write
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/gen-tenant-isolation-pgtap.mjs --check  # exit 1 if stale
 *
 * For every table the registry classifies tenant- or event-scoped with its
 * own tenant_id ('own' or 'derived'), the test:
 *   1. checks the tenant policies exist (a PERMISSIVE and a RESTRICTIVE one,
 *      TO tenant_app only) and that tenant_app has no BYPASSRLS;
 *   2. seeds two tenants — Stellr and a canary tenant — with rows in every
 *      table (as the migration owner), and asserts each tenant really has
 *      rows, so no assertion below can pass on an empty table;
 *   3. for each tenant context in turn, as tenant_app with the tenant pinned
 *      the way lib/tenancy/db.ts pins it: sees 0 of the other tenant's rows
 *      and exactly its own; UPDATE and DELETE of the other's rows touch 0;
 *      INSERT of an other-tenant row is refused (42501); an own-tenant INSERT
 *      works (so the policies are not simply deny-all);
 *   4. with no tenant pinned, or garbage pinned, tenant_app sees and writes
 *      nothing (fail closed);
 *   5. afterwards, as the owner, every tenant still has exactly its rows
 *      (seed + its own inserts): nothing moved, nothing was deleted.
 * Beyond its own rows (lib/tenancy/tenant-role.ts):
 *   * routing, ownership and role tables (events, tenant_domains,
 *     tenant_memberships) are read-only to tenant_app: INSERT, UPDATE and
 *     DELETE are refused even on its own rows;
 *   * platform-level tables that carry a tenant_id (platform_audit_events,
 *     tenant_data_keys: TENANT_APP_NO_ACCESS_TABLES) grant tenant_app nothing;
 *   * a row it writes may not point at the other tenant's parent row, nor at
 *     an id that does not exist (the same refusal, so no existence oracle),
 *     nor at an event its tenant does not have; the same row pointing at its
 *     own parent works. The set of foreign keys between tenant tables is
 *     checked against TENANT_PARENT_REFS, so a new one cannot go unguarded.
 * tenant_app cannot call pgTAP itself (pgTAP keeps its state in tables only
 * the owner can write), so each observation is recorded into a temp table as
 * tenant_app and asserted after RESET ROLE.
 *
 * A tenant table with no entry in FIXTURES fails generation — so does a
 * fixture for a table that is not a tenant table. lib/tenancy/isolation.test.ts
 * fails when the checked-in file is stale.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { TABLE_REGISTRY } from '../lib/tenancy/registry.ts'
import { STELLR_TENANT_ID } from '../lib/tenancy/constants.ts'
import { TENANT_APP_NO_ACCESS_TABLES, TENANT_APP_READ_ONLY_TABLES, TENANT_PARENT_REFS } from '../lib/tenancy/tenant-role.ts'

export const OUTPUT = 'supabase/tests/database/tenant_isolation.test.sql'

/** The canary tenant the matrix seeds beside Stellr. Test-only. */
export const CANARY_TENANT_ID = 'c0ffee00-0000-4000-8000-0000000000b2'

/** The role and the setting lib/tenancy/db.ts uses (keep in step with it). */
export const TENANT_ROLE = 'tenant_app'
export const TENANT_SETTING = 'stellr.tenant_id'

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`

/**
 * Per-tenant fixture context. `primary` events hold the seeded rows; the
 * own-tenant INSERT uses `secondary` events, so a one-row-per-event unique
 * key never collides with the seed.
 */
export const TENANTS = {
  a: {
    id: STELLR_TENANT_ID,
    label: 'Stellr',
    primary: { slug: 'iso-a-event', sanity: 'iso-a-sanity' },
    secondary: { slug: 'iso-a-event-2', sanity: 'iso-a-sanity-2' },
    registration: 'a0000000-0000-4000-8000-000000000001',
    module: 'a0000000-0000-4000-8000-000000000002',
  },
  b: {
    id: CANARY_TENANT_ID,
    label: 'canary',
    primary: { slug: 'iso-b-event', sanity: 'iso-b-sanity' },
    secondary: { slug: 'iso-b-event-2', sanity: 'iso-b-sanity-2' },
    registration: 'b0000000-0000-4000-8000-000000000001',
    module: 'b0000000-0000-4000-8000-000000000002',
  },
}
const MEMBER = 'c0000000-0000-4000-8000-000000000001'
const PRODUCT = 'c0000000-0000-4000-8000-000000000002'
const VARIANT = 'c0000000-0000-4000-8000-000000000003'
const DEFINITION = 'c0000000-0000-4000-8000-000000000004'
/** An id no row has: referencing it must be refused exactly like another tenant's id. */
const MISSING = 'd0000000-0000-4000-8000-00000000dead'

/** The event a ref check writes into: one per (tenant, ref), so one-row-per-event keys never collide. */
const refEvent = (tag, k) => ({ slug: `iso-${tag}-ref-${k}`, sanity: `iso-${tag}-ref-sanity-${k}` })
/** An event no tenant has. */
const UNKNOWN_EVENT = { slug: 'iso-unknown-event', sanity: 'iso-unknown-sanity' }
/** Columns a ref row needs beyond its fixture (a table CHECK ties them to the ref). */
const REF_EXTRA = {
  'public.event_badge_templates.company_id': { audience: lit('company') },
}
const extraFor = (r) => REF_EXTRA[`${r.table}.${r.column}`] ?? {}

/**
 * One row per tenant table. `f(c)` returns column -> SQL expression, where
 * c = { tag, t (TENANTS entry), ev (the event to use), s (a suffix unique to
 * this row), seed (true for the seeded row) }. Parents first: rows whose
 * fixtures name the seeded registration or module come after them.
 */
export const FIXTURES = {
  'public.registrations': (c) => ({
    ...(c.seed ? { id: lit(c.t.registration) } : {}),
    event_slug: lit(c.ev.slug), event_title: lit('Iso'), type: lit('individual'),
  }),
  'public.training_modules': (c) => ({
    ...(c.seed ? { id: lit(c.t.module) } : {}),
    title: lit(`Iso module ${c.s}`), event_ref: lit(c.ev.sanity),
  }),
  'public.agreements': (c) => ({
    event_slug: lit(c.ev.slug), event_title: lit('Iso'), envelope_id: lit(`iso-env-${c.s}`),
    signer_name: lit('Iso Signer'), signer_email: lit('signer@example.test'), minor_name: lit('Iso Minor'),
  }),
  'public.community_resources': (c) => ({ title: lit(`Iso resource ${c.s}`), event_ref: lit(c.ev.sanity) }),
  'public.community_spaces': (c) => ({ slug: lit(`iso-space-${c.s}`), name: lit('Iso'), sanity_event_id: lit(c.ev.sanity) }),
  'public.credentials': (c) => ({
    number: lit(`ISO-${c.s}`), source: lit('manual'), recipient_name: lit('Iso'), title: lit('Iso'), event_slug: lit(c.ev.slug),
  }),
  'public.event_award_assignments': (c) => ({ event_slug: lit(c.ev.slug), award_type: lit('overall_champion') }),
  'public.event_badge_templates': (c) => ({
    event_slug: lit(c.ev.slug), format: lit('avery_5392'), audience: lit('everyone'), artwork_path: lit('iso.png'),
  }),
  'public.event_certificate_templates': (c) => ({ event_slug: lit(c.ev.slug), award_type: lit('participation'), artwork_path: lit('iso.png') }),
  'public.event_companies': (c) => ({ event_slug: lit(c.ev.slug), number: '1' }),
  'public.event_email_sends': (c) => ({ event_slug: lit(c.ev.slug), email_name: lit('iso'), subject: lit('Iso'), trigger: lit('manual') }),
  'public.event_emails': (c) => ({ event_slug: lit(c.ev.slug), name: lit('iso') }),
  'public.event_manager_assignments': (c) => ({ clerk_user_id: lit(`user_iso_${c.s}`), event_slug: lit(c.ev.slug) }),
  'public.event_participations': (c) => ({ member_id: lit(MEMBER), event_slug: lit(c.ev.slug) }),
  'public.event_refunds': (c) => ({ refund_type: lit('none'), event_slug: lit(c.ev.slug) }),
  'public.event_settings': (c) => ({ event_slug: lit(c.ev.slug) }),
  'public.event_store_offerings': (c) => ({ event_slug: lit(c.ev.slug), variant_id: lit(VARIANT), treatment: lit('included') }),
  'public.events': (c) => ({
    tenant_id: lit(c.t.id), slug: lit(`iso-own-${c.s}`), sanity_id: lit(`iso-own-sanity-${c.s}`), title: lit('Iso'),
    time_zone: lit('UTC'), country: lit('US'), currency: lit('usd'), grade_system: lit('us_grades'),
  }),
  'public.group_invoices': (c) => ({
    stripe_invoice_id: lit(`in_iso_${c.s}`), kind: lit('seats'), status: lit('draft'), seats: '1', per_seat_cents: '0', event_slug: lit(c.ev.slug),
  }),
  'public.group_join_tokens': (c) => ({
    token: lit(`iso-token-${c.s}`), registration_id: lit(c.t.registration), event_slug: lit(c.ev.slug), event_title: lit('Iso'),
  }),
  'public.member_groups': (c) => ({ owner_id: lit(MEMBER), name: lit('Iso'), event_slug: lit(c.ev.slug) }),
  'public.mentoring_cohorts': (c) => ({ name: lit(`Iso ${c.s}`), sanity_event_id: lit(c.ev.sanity) }),
  'public.merch_batches': (c) => ({ batch_type: lit('event_venue'), event_slug: lit(c.ev.slug) }),
  'public.refund_policies': (c) => ({ scope: lit('event'), tiers: `'[]'::jsonb`, event_slug: lit(c.ev.slug) }),
  'public.scholarship_applications': (c) => ({
    first_name: lit('Iso'), last_name: lit('Applicant'), email: lit('applicant@example.test'), brief: lit('Iso'), event_slug: lit(c.ev.slug),
  }),
  'public.store_event_discounts': (c) => ({ percent_off: '10', event_slug: lit(c.ev.slug) }),
  'public.store_orders': (c) => ({ email: lit('buyer@example.test'), event_slug: lit(c.ev.slug) }),
  'public.survey_access_log': (c) => ({ actor: lit('staff'), action: lit('view'), event_slug: lit(c.ev.slug) }),
  'public.survey_distributions': (c) => ({
    definition_id: lit(DEFINITION), event_slug: lit(c.ev.slug), event_date: `'2026-11-06'::date`, event_time_zone: lit('UTC'),
    opens_at: `'2026-11-07T00:00:00Z'::timestamptz`, closes_at: `'2026-11-21T00:00:00Z'::timestamptz`,
  }),
  'public.survey_responses': (c) => ({
    definition_id: lit(DEFINITION), event_slug: lit(c.ev.slug), source: lit('legacy_import'), legacy_ref: lit(`iso-${c.s}`),
  }),
  'public.team_profiles': (c) => ({ event_slug: lit(c.ev.slug), token_hash: lit(`iso-hash-${c.s}`) }),
  'public.tenant_domains': (c) => ({ host: lit(`iso-${c.s}.example.test`), tenant_id: lit(c.t.id) }),
  'public.tenant_memberships': (c) => ({ tenant_id: lit(c.t.id), role: lit('staff'), clerk_user_id: lit(`user_iso_${c.s}`) }),
  'public.training_assignments': (c) => ({ module_id: lit(c.t.module), event_ref: lit(c.ev.sanity), event_role: lit('mentor') }),
  'public.volunteer_event_interest': (c) => ({ member_id: lit(MEMBER), event_slug: lit(c.ev.slug), event_title: lit('Iso') }),
}

/** The tables the matrix covers: registry 'own' and 'derived' entries, sorted. */
export function tenantTables(registry = TABLE_REGISTRY) {
  return Object.keys(registry)
    .filter((n) => ['own', 'derived'].includes(registry[n].tenantColumn))
    .sort()
}

/** Tables the registry scopes to a tenant only through a parent (no tenant_id yet). */
export function viaParentTables(registry = TABLE_REGISTRY) {
  return Object.keys(registry)
    .filter((n) => registry[n].tenantColumn === 'via_parent')
    .sort()
}

/** Problems with FIXTURES against the registry (none = generatable). */
export function fixtureProblems(registry = TABLE_REGISTRY, fixtures = FIXTURES) {
  const want = new Set(tenantTables(registry))
  const out = []
  for (const t of want) if (!fixtures[t]) out.push(`${t}: tenant table with no fixture in scripts/gen-tenant-isolation-pgtap.mjs`)
  for (const t of Object.keys(fixtures)) if (!want.has(t)) out.push(`${t}: fixture for a table that is not an own/derived tenant table`)
  return out
}

/** Parents first (FIXTURES order), then the rest alphabetically. */
function seedOrder(tables, fixtures) {
  const parents = Object.keys(fixtures).filter((t) => ['public.registrations', 'public.training_modules'].includes(t))
  return [...parents, ...tables.filter((t) => !parents.includes(t))]
}

/** Foreign keys from a tenant table to a tenant table that tenant_app can see (not via_parent). */
export function checkedRefs(registry = TABLE_REGISTRY, refs = TENANT_PARENT_REFS) {
  const via = new Set(viaParentTables(registry))
  return refs.filter((r) => !via.has(r.parent))
}

function insertSql(table, cols) {
  const names = Object.keys(cols)
  return `INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map((n) => cols[n]).join(', ')})`
}

export function generate(registry = TABLE_REGISTRY, fixtures = FIXTURES) {
  const problems = fixtureProblems(registry, fixtures)
  if (problems.length) throw new Error(problems.join('\n'))
  const tables = tenantTables(registry)
  const own = new Set(tables.filter((n) => registry[n].tenantColumn === 'own'))
  const readOnly = new Set(TENANT_APP_READ_ONLY_TABLES)
  const via = new Set(viaParentTables(registry))
  const refs = TENANT_PARENT_REFS.map((r, k) => ({ ...r, k, checked: !via.has(r.parent) }))
  const row = (table, tag, ev, s, seed, extra = {}) =>
    insertSql(table, {
      ...fixtures[table]({ tag, t: TENANTS[tag], ev: typeof ev === 'string' ? TENANTS[tag][ev] : ev, s: `${tag}-${s}`, seed }),
      ...extra,
    })
  /** Rows the tenant itself adds to `table` in the matrix: its insert_own (if writable) plus one per checked ref. */
  const ownAdds = (n) => (readOnly.has(n) ? 0 : 1) + refs.filter((r) => r.table === n && r.checked).length

  const lines = []
  let tests = 0
  const t = (sql) => {
    lines.push(sql)
    tests += 1
  }
  const ROLE = TENANT_ROLE
  const A = TENANTS.a.id
  const B = TENANTS.b.id

  // ── 1. Structure ─────────────────────────────────────────────────────────
  lines.push('-- 1. The tenant role cannot escape RLS, and every tenant table carries both tenant policies.')
  t(`SELECT ok(EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${lit(ROLE)}), ${lit(`role ${ROLE} exists`)});`)
  t(
    `SELECT ok((SELECT NOT (rolsuper OR rolbypassrls OR rolcanlogin OR rolcreaterole OR rolcreatedb OR rolreplication) FROM pg_roles WHERE rolname = ${lit(ROLE)}),
  ${lit(`${ROLE} has no BYPASSRLS, no superuser, no login and cannot create roles or databases`)});`,
  )
  t(
    `SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_roles r
  WHERE r.rolname IN ('anon', 'authenticated', 'authenticator', 'service_role')
    AND pg_has_role(r.oid, (SELECT oid FROM pg_roles WHERE rolname = ${lit(ROLE)}), 'MEMBER')
), ${lit(`no API role (anon, authenticated, authenticator, service_role) can become ${ROLE}`)});`,
  )
  t(`SELECT ok(NOT has_function_privilege('anon', 'public.app_tenant_id()', 'EXECUTE'), 'anon cannot execute app_tenant_id()');`)
  t(`SELECT ok(NOT has_function_privilege('authenticated', 'public.app_tenant_id()', 'EXECUTE'), 'authenticated cannot execute app_tenant_id()');`)
  t(`SELECT ok(has_function_privilege(${lit(ROLE)}, 'public.app_tenant_id()', 'EXECUTE'), ${lit(`${ROLE} can execute app_tenant_id()`)});`)
  t(
    `SELECT is((SELECT provolatile::text || prosecdef::text FROM pg_proc WHERE oid = 'public.app_tenant_id()'::regprocedure), 'sfalse',
  'app_tenant_id() is STABLE and SECURITY INVOKER');`,
  )
  const selfRef = `'public.tenant_self_ref_visible(text, uuid)'`
  t(
    `SELECT ok(NOT has_function_privilege('anon', ${selfRef}, 'EXECUTE') AND NOT has_function_privilege('authenticated', ${selfRef}, 'EXECUTE')
  AND (SELECT NOT prosecdef FROM pg_proc WHERE oid = ${selfRef}::regprocedure),
  'tenant_self_ref_visible() is SECURITY INVOKER (RLS limits it) and anon/authenticated cannot execute it');`,
  )
  for (const n of tables) {
    t(
      `SELECT is((SELECT string_agg(permissive || ':' || array_to_string(roles, ','), ' ' ORDER BY permissive)
  FROM pg_policies WHERE schemaname || '.' || tablename = ${lit(n)} AND policyname IN ('tenant_isolation', 'tenant_isolation_guard')),
  ${lit(`PERMISSIVE:${ROLE} RESTRICTIVE:${ROLE}`)}, ${lit(`${n}: tenant_isolation (permissive) and tenant_isolation_guard (restrictive), TO ${ROLE} only`)});`,
    )
    if (readOnly.has(n)) {
      t(
        `SELECT ok(has_table_privilege(${lit(ROLE)}, ${lit(n)}, 'SELECT')
  AND NOT has_table_privilege(${lit(ROLE)}, ${lit(n)}, 'INSERT, UPDATE, DELETE, TRUNCATE')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = ${lit(n)}::regclass), ${lit(`${n}: RLS on, and ${ROLE} may read it but never write it (platform-written)`)});`,
      )
    } else {
      t(
        `SELECT ok(${['SELECT', 'INSERT', 'UPDATE', 'DELETE'].map((p) => `has_table_privilege(${lit(ROLE)}, ${lit(n)}, '${p}')`).join(' AND ')}
  AND NOT has_table_privilege(${lit(ROLE)}, ${lit(n)}, 'TRUNCATE')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = ${lit(n)}::regclass), ${lit(`${n}: RLS on and ${ROLE} holds the table privileges the policies gate`)});`,
      )
    }
    const entry = registry[n]
    const mustMention = [
      ...(entry.tenantColumn === 'derived' && entry.eventKey ? [entry.eventKey.column] : []),
      ...refs.filter((r) => r.table === n).map((r) => r.column),
    ]
    if (mustMention.length) {
      t(
        `SELECT ok((SELECT ${mustMention.map((c) => `with_check ~ ${lit(`\\m${c}\\M`)}`).join(' AND ')}
  FROM pg_policies WHERE schemaname || '.' || tablename = ${lit(n)} AND policyname = 'tenant_isolation_guard'),
  ${lit(`${n}: the guard's WITH CHECK confines ${mustMention.join(', ')} to the tenant's own rows`)});`,
      )
    }
  }
  const tenantSet = [...tables, ...viaParentTables(registry)]
  t(
    `SELECT is(
  (SELECT string_agg(src || '.' || col || '->' || dst, ' ' ORDER BY src || '.' || col) FROM (
    SELECT c.conrelid::regclass::text AS src, a.attname::text AS col, c.confrelid::regclass::text AS dst
    FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f'
      AND c.conrelid = ANY (ARRAY[${tables.map((n) => `${lit(n)}::regclass`).join(', ')}])
      AND c.confrelid = ANY (ARRAY[${tenantSet.map((n) => `${lit(n)}::regclass`).join(', ')}])
  ) fk),
  ${lit(refs.map((r) => `${r.table.replace(/^public\./, '')}.${r.column}->${r.parent.replace(/^public\./, '')}`).sort().join(' '))},
  'every foreign key between tenant tables is listed in lib/tenancy/tenant-role.ts TENANT_PARENT_REFS (and so guarded)');`,
  )
  for (const n of Object.keys(TENANT_APP_NO_ACCESS_TABLES).sort()) {
    t(
      `SELECT ok(NOT has_table_privilege(${lit(ROLE)}, ${lit(n)}, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = ${lit(n)}::regclass),
  ${lit(`${n}: platform-level (lib/tenancy/tenant-role.ts TENANT_APP_NO_ACCESS_TABLES), RLS on and ${ROLE} has no privilege on it at all`)});`,
    )
  }
  for (const n of viaParentTables(registry)) {
    t(
      `SELECT ok(NOT has_table_privilege(${lit(ROLE)}, ${lit(n)}, 'SELECT, INSERT, UPDATE, DELETE'),
  ${lit(`${n}: no tenant_id yet (via_parent), so ${ROLE} has no privilege on it at all`)});`,
    )
  }
  t(
    `SELECT is((SELECT count(*)::int FROM pg_class WHERE oid = ANY (ARRAY[${tables.map((n) => `${lit(n)}::regclass`).join(', ')}]) AND relforcerowsecurity), 0,
  'no tenant table has FORCE ROW LEVEL SECURITY yet (a later, owner-gated step: docs/TENANCY-S4.md)');`,
  )
  t(
    `SELECT ok(NOT has_function_privilege('anon', 'public.storage_object_tenant_id(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.storage_object_tenant_id(text)', 'EXECUTE'),
  'anon and authenticated cannot execute storage_object_tenant_id()');`,
  )

  // ── 2. Fixtures ──────────────────────────────────────────────────────────
  lines.push(
    '',
    '-- 2. Fixtures, written as the migration owner (RLS does not bind it): a canary tenant beside Stellr,',
    '--    two events each, shared parents, then one row per tenant in every tenant table.',
    `INSERT INTO public.tenants (id, slug, legal_name, display_name, country, payment_region, currency, time_zone)
  VALUES (${lit(B)}, 'iso-canary', 'Iso Canary Pty Ltd', 'Iso Canary', 'AU', 'AU', 'aud', 'Australia/Sydney');`,
  )
  for (const tag of ['a', 'b']) {
    const tn = TENANTS[tag]
    for (const ev of [tn.primary, tn.secondary, ...refs.filter((r) => r.checked).map((r) => refEvent(tag, r.k))]) {
      lines.push(
        `INSERT INTO public.events (tenant_id, slug, sanity_id, title, time_zone, country, currency, grade_system)
  VALUES (${lit(tn.id)}, ${lit(ev.slug)}, ${lit(ev.sanity)}, 'Iso event', 'UTC', 'US', 'usd', 'us_grades');`,
      )
    }
  }
  lines.push(
    `INSERT INTO public.members (id, first_name, last_name, email, event_role) VALUES (${lit(MEMBER)}, 'Iso', 'Member', 'iso-member@example.test', 'participant');
INSERT INTO public.store_products (id, slug, name) VALUES (${lit(PRODUCT)}, 'iso-product', 'Iso product');
INSERT INTO public.store_variants (id, product_id, sku) VALUES (${lit(VARIANT)}, ${lit(PRODUCT)}, 'ISO-SKU');
INSERT INTO public.survey_definitions (id, key, version, title, definition, definition_sha256)
  VALUES (${lit(DEFINITION)}, 'iso_survey', 1, 'Iso survey', '{}'::jsonb, repeat('0', 64));`,
  )
  for (const n of seedOrder(tables, fixtures)) {
    for (const tag of ['a', 'b']) lines.push(`${row(n, tag, 'primary', 'seed', true)};`)
  }

  // Expected rows per (table, tenant), counted by the owner over the whole table.
  lines.push(
    '',
    'CREATE TEMP TABLE iso_expect (tbl text, tenant uuid, n int) ON COMMIT DROP;',
    ...tables.map(
      (n) => `INSERT INTO iso_expect SELECT ${lit(n)}, tenant_id, count(*)::int FROM ${n} WHERE tenant_id IS NOT NULL GROUP BY tenant_id;`,
    ),
    '-- One seeded row of each parent table per tenant: what the ref checks point at.',
    'CREATE TEMP TABLE iso_parent (tbl text, tenant uuid, id uuid) ON COMMIT DROP;',
    ...[...new Set(refs.filter((r) => r.checked).map((r) => r.parent))]
      .sort()
      .map((p) => `INSERT INTO iso_parent SELECT ${lit(p)}, tenant_id, (array_agg(id ORDER BY id))[1] FROM ${p} WHERE tenant_id IS NOT NULL GROUP BY tenant_id;`),
    `-- What tenant_app observed: (context, table, check) -> value. Asserted after RESET ROLE.
CREATE TEMP TABLE iso_obs (ctx text, tbl text, chk text, v text) ON COMMIT DROP;
-- Runs one statement as the current role: its row count, or ERR:<SQLSTATE>.
CREATE FUNCTION pg_temp.iso_run(q text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE n bigint;
BEGIN
  EXECUTE q;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n::text;
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR:' || SQLSTATE;
END $f$;
GRANT SELECT ON iso_expect TO ${ROLE};
GRANT SELECT ON iso_parent TO ${ROLE};
GRANT INSERT ON iso_obs TO ${ROLE};
GRANT EXECUTE ON FUNCTION pg_temp.iso_run(text) TO ${ROLE};`,
  )
  const expect = (n, id) => `(SELECT n FROM iso_expect WHERE tbl = ${lit(n)} AND tenant = ${lit(id)})`
  for (const n of tables) {
    t(
      `SELECT ok(${expect(n, A)} >= 1 AND ${expect(n, B)} >= 1, ${lit(`${n}: both tenants have rows (the matrix cannot pass on an empty table)`)});`,
    )
  }
  for (const p of [...new Set(refs.filter((r) => r.checked).map((r) => r.parent))].sort()) {
    t(
      `SELECT is((SELECT count(DISTINCT tenant)::int FROM iso_parent WHERE tbl = ${lit(p)} AND tenant IN (${lit(A)}, ${lit(B)})), 2,
  ${lit(`fixture: both tenants have a ${p} row for the ref checks to point at`)});`,
    )
  }
  t(
    `SELECT is((SELECT tenant_id FROM public.registrations WHERE id = ${lit(TENANTS.b.registration)}), ${lit(B)}::uuid,
  'fixture: the derivation trigger gave the canary event''s rows the canary tenant');`,
  )

  // ── 3. The matrix ────────────────────────────────────────────────────────
  const obs = (ctx, n, chk, q) => `INSERT INTO iso_obs VALUES (${lit(ctx)}, ${lit(n)}, ${lit(chk)}, pg_temp.iso_run(${lit(q)}));`
  const got = (ctx, n, chk) => `(SELECT v FROM iso_obs WHERE ctx = ${lit(ctx)} AND tbl = ${lit(n)} AND chk = ${lit(chk)})`
  for (const [ctx, other] of [['a', 'b'], ['b', 'a']]) {
    const me = TENANTS[ctx]
    const them = TENANTS[other]
    lines.push(
      '',
      `-- 3${ctx}. As ${ROLE} in the ${me.label} context: 0 of the ${them.label} tenant's rows, all of its own.`,
      `SET LOCAL ROLE ${ROLE};`,
      `SELECT set_config(${lit(TENANT_SETTING)}, ${lit(me.id)}, true);`,
    )
    for (const n of tables) {
      lines.push(
        obs(ctx, n, 'see_other', `SELECT 1 FROM ${n} WHERE tenant_id = '${them.id}'`),
        obs(ctx, n, 'see_all', `SELECT 1 FROM ${n}`),
        obs(ctx, n, 'update_other', `UPDATE ${n} SET tenant_id = tenant_id WHERE tenant_id = '${them.id}'`),
        obs(ctx, n, 'delete_other', `DELETE FROM ${n} WHERE tenant_id = '${them.id}'`),
        obs(ctx, n, 'insert_other', row(n, other, 'secondary', `by-${ctx}`, false)),
        obs(ctx, n, 'insert_own', row(n, ctx, 'secondary', 'own', false)),
        // On an 'own' table RLS must refuse this. On a 'derived' table the
        // derivation trigger rewrites tenant_id back from the row's event
        // (log mode), or another trigger refuses the update; either way
        // section 5 proves no row changed tenant.
        obs(ctx, n, 'move_own', `UPDATE ${n} SET tenant_id = '${them.id}' WHERE tenant_id = '${me.id}'`),
      )
      if (readOnly.has(n)) {
        lines.push(
          obs(ctx, n, 'update_own', `UPDATE ${n} SET tenant_id = tenant_id WHERE tenant_id = '${me.id}'`),
          obs(ctx, n, 'delete_own', `DELETE FROM ${n} WHERE tenant_id = '${me.id}'`),
        )
      }
      if (registry[n].tenantColumn === 'derived') {
        lines.push(obs(ctx, n, 'event_unknown', row(n, ctx, UNKNOWN_EVENT, 'unknown-event', false, { tenant_id: lit(me.id) })))
      }
      for (const r of refs.filter((x) => x.table === n)) {
        const ev = r.checked ? refEvent(ctx, r.k) : 'secondary'
        const parentOf = (tag) => `(SELECT id FROM iso_parent WHERE tbl = '${r.parent}' AND tenant = '${TENANTS[tag].id}')`
        lines.push(obs(ctx, n, `ref_missing:${r.column}`, row(n, ctx, ev, `ref-missing-${r.k}`, false, { ...extraFor(r), [r.column]: lit(MISSING) })))
        if (r.checked) {
          lines.push(
            obs(ctx, n, `ref_other:${r.column}`, row(n, ctx, ev, `ref-other-${r.k}`, false, { ...extraFor(r), [r.column]: parentOf(other) })),
            obs(ctx, n, `ref_own:${r.column}`, row(n, ctx, ev, `ref-own-${r.k}`, false, { ...extraFor(r), [r.column]: parentOf(ctx) })),
          )
        }
      }
    }
    lines.push(
      obs(ctx, 'public.tenants', 'see_all', 'SELECT 1 FROM public.tenants'),
      obs(ctx, 'public.tenants', 'see_self', `SELECT 1 FROM public.tenants WHERE id = '${me.id}'`),
      obs(ctx, 'public.tenants', 'update_self', `UPDATE public.tenants SET display_name = display_name WHERE id = '${me.id}'`),
      'RESET ROLE;',
      `SELECT set_config(${lit(TENANT_SETTING)}, '', true);`,
    )
    for (const n of tables) {
      t(`SELECT is(${got(ctx, n, 'see_other')}, '0', ${lit(`${me.label} context: sees 0 ${them.label} rows of ${n}`)});`)
      t(`SELECT is(${got(ctx, n, 'see_all')}, ${expect(n, me.id)}::text, ${lit(`${me.label} context: sees exactly its own rows of ${n}`)});`)
      // A read-only table refuses the statement outright (no privilege); a writable one touches 0 rows.
      const none = readOnly.has(n) ? 'ERR:42501' : '0'
      const how = readOnly.has(n) ? 'is refused outright' : 'touches 0'
      t(`SELECT is(${got(ctx, n, 'update_other')}, '${none}', ${lit(`${me.label} context: UPDATE of ${them.label} rows of ${n} ${how}`)});`)
      t(`SELECT is(${got(ctx, n, 'delete_other')}, '${none}', ${lit(`${me.label} context: DELETE of ${them.label} rows of ${n} ${how}`)});`)
      t(`SELECT is(${got(ctx, n, 'insert_other')}, 'ERR:42501', ${lit(`${me.label} context: INSERT of a ${them.label} row into ${n} is refused by RLS`)});`)
      if (readOnly.has(n)) {
        for (const [chk, verb] of [['insert_own', 'INSERT into'], ['update_own', 'UPDATE its own rows of'], ['delete_own', 'DELETE its own rows of']]) {
          t(`SELECT is(${got(ctx, n, chk)}, 'ERR:42501', ${lit(`${me.label} context: cannot ${verb} ${n} (read-only to ${ROLE}; platform code writes it)`)});`)
        }
      } else {
        t(`SELECT is(${got(ctx, n, 'insert_own')}, '1', ${lit(`${me.label} context: INSERT of its own row into ${n} works`)});`)
      }
      if (registry[n].tenantColumn === 'derived') {
        t(`SELECT is(${got(ctx, n, 'event_unknown')}, 'ERR:42501', ${lit(`${me.label} context: a ${n} row under an event its tenant does not have is refused, even with its own tenant_id`)});`)
      }
      for (const r of refs.filter((x) => x.table === n)) {
        t(`SELECT is(${got(ctx, n, `ref_missing:${r.column}`)}, 'ERR:42501', ${lit(`${me.label} context: ${n}.${r.column} naming an id that does not exist is refused by RLS (no FK error to probe with)`)});`)
        if (r.checked) {
          t(`SELECT is(${got(ctx, n, `ref_other:${r.column}`)}, 'ERR:42501', ${lit(`${me.label} context: ${n}.${r.column} pointing at the ${them.label} tenant's ${r.parent} row is refused`)});`)
          t(`SELECT is(${got(ctx, n, `ref_own:${r.column}`)}, '1', ${lit(`${me.label} context: ${n}.${r.column} pointing at its own ${r.parent} row works`)});`)
        }
      }
      if (own.has(n)) {
        t(`SELECT is(${got(ctx, n, 'move_own')}, 'ERR:42501', ${lit(`${me.label} context: moving its own ${n} rows to the ${them.label} tenant is refused`)});`)
      }
    }
    t(`SELECT is(${got(ctx, 'public.tenants', 'see_all')}, '1', ${lit(`${me.label} context: sees exactly one tenants row`)});`)
    t(`SELECT is(${got(ctx, 'public.tenants', 'see_self')}, '1', ${lit(`${me.label} context: that row is its own tenant`)});`)
    t(`SELECT is(${got(ctx, 'public.tenants', 'update_self')}, 'ERR:42501', ${lit(`${me.label} context: cannot change its tenants row`)});`)
  }

  // ── 4. Fail closed ───────────────────────────────────────────────────────
  lines.push('', `-- 4. ${ROLE} with no tenant pinned, or garbage pinned, sees and writes nothing.`, `SET LOCAL ROLE ${ROLE};`, `SELECT set_config(${lit(TENANT_SETTING)}, '', true);`)
  for (const n of tables) {
    lines.push(obs('none', n, 'see_all', `SELECT 1 FROM ${n}`), obs('none', n, 'insert_own', row(n, 'a', 'secondary', 'unpinned', false)))
  }
  lines.push(`SELECT set_config(${lit(TENANT_SETTING)}, 'not-a-uuid', true);`)
  for (const n of tables) lines.push(obs('garbage', n, 'see_all', `SELECT 1 FROM ${n}`))
  lines.push(`SELECT set_config(${lit(TENANT_SETTING)}, ${lit(B.toUpperCase())}, true);`)
  lines.push(obs('upper', 'public.registrations', 'see_all', 'SELECT 1 FROM public.registrations'))
  lines.push('RESET ROLE;', `SELECT set_config(${lit(TENANT_SETTING)}, '', true);`)
  for (const n of tables) {
    t(`SELECT is(${got('none', n, 'see_all')}, '0', ${lit(`no tenant pinned: sees 0 rows of ${n}`)});`)
    t(`SELECT is(${got('none', n, 'insert_own')}, 'ERR:42501', ${lit(`no tenant pinned: INSERT into ${n} is refused`)});`)
    t(`SELECT is(${got('garbage', n, 'see_all')}, '0', ${lit(`garbage pinned: sees 0 rows of ${n}, without an error`)});`)
  }
  t(`SELECT is(${got('upper', 'public.registrations', 'see_all')}, '0', 'a non-canonical (upper-case) tenant id matches nothing: lib/tenancy/db.ts always pins lower case');`)

  // ── 5. Nothing moved ─────────────────────────────────────────────────────
  lines.push('', '-- 5. As the owner again: each tenant has exactly its seed rows plus the one it inserted itself.')
  for (const n of tables) {
    for (const tag of ['a', 'b']) {
      const id = TENANTS[tag].id
      t(
        `SELECT is((SELECT count(*)::int FROM ${n} WHERE tenant_id = ${lit(id)}), ${expect(n, id)} + ${ownAdds(n)},
  ${lit(`${n}: the ${TENANTS[tag].label} tenant kept every row and gained only ${ownAdds(n) === 0 ? 'nothing (read-only to the tenant role)' : 'its own inserts'}`)});`,
      )
    }
  }

  // ── 6. Storage paths ─────────────────────────────────────────────────────
  lines.push('', '-- 6. Storage: a path is a tenant\'s only under its tenant id; every legacy path stays Stellr\'s.')
  const sot = (p) => `public.storage_object_tenant_id(${p})`
  t(`SELECT is(${sot(lit(`${B}/events/badge.png`))}, ${lit(B)}::uuid, 'storage: {tenant_id}/… belongs to that tenant');`)
  t(`SELECT is(${sot(lit(`${A}/events/badge.png`))}, ${lit(A)}::uuid, 'storage: Stellr''s own prefix is Stellr''s');`)
  t(`SELECT is(${sot(lit(`${MEMBER}/1700000000000-licence.pdf`))}, ${lit(A)}::uuid, 'storage: a legacy {member_id}/… path is Stellr''s, not mistaken for a tenant');`)
  t(`SELECT is(${sot(lit('event-artwork/iso-b-event/badge.png'))}, ${lit(A)}::uuid, 'storage: a legacy named-prefix path is Stellr''s');`)
  t(`SELECT is(${sot(lit(B))}, ${lit(A)}::uuid, 'storage: a bare tenant id with no object name is not a tenant path');`)
  t(`SELECT is(${sot(lit(`${B.toUpperCase()}/x.png`))}, ${lit(A)}::uuid, 'storage: only the canonical lower-case id counts');`)
  t(`SELECT is(${sot('NULL')}, ${lit(A)}::uuid, 'storage: NULL is Stellr''s (never NULL, so a policy cannot match it by accident)');`)
  lines.push(`SET LOCAL ROLE ${ROLE};`, `SELECT set_config(${lit(TENANT_SETTING)}, ${lit(A)}, true);`)
  lines.push(`INSERT INTO iso_obs VALUES ('a', 'storage', 'other_prefix', (${sot(lit(`${B}/x.png`))})::text);`)
  lines.push('RESET ROLE;', `SELECT set_config(${lit(TENANT_SETTING)}, '', true);`)
  t(
    `SELECT is(${got('a', 'storage', 'other_prefix')}, ${lit(B)},
  'storage: in Stellr''s context the canary prefix still reads as the canary''s (the definer sees every tenant), so a policy never hands it to Stellr');`,
  )

  const header = `-- GENERATED by scripts/gen-tenant-isolation-pgtap.mjs from lib/tenancy/registry.ts.
-- Do not edit by hand: change the registry (or the generator's FIXTURES) and regenerate
--   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/gen-tenant-isolation-pgtap.mjs
-- lib/tenancy/isolation.test.ts fails while this file is stale.
--
-- pgTAP: the S4 cross-tenant matrix (multi-tenancy plan). ${tables.length} tenant tables, two tenants,
-- every check counted so none can pass on an empty table. Runs in the CI \`db\` job. Everything rolls back.
BEGIN;
SET LOCAL search_path = extensions, public;
-- RLS must be in force for the matrix to mean anything (a session restored
-- from a pg_dump script can carry row_security = off).
SET LOCAL row_security = on;
-- Let the test runner become ${TENANT_ROLE} (rolled back with everything else).
-- A superuser runner needs no grant; a non-superuser runner that created the
-- role holds ADMIN on it but, on Postgres 16+, not SET until granted.
GRANT ${TENANT_ROLE} TO CURRENT_USER;

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
      console.error(`✗ ${OUTPUT} is stale — run scripts/gen-tenant-isolation-pgtap.mjs`)
      process.exit(1)
    }
    console.log(`✓ ${OUTPUT} is up to date`)
    return
  }
  writeFileSync(OUTPUT, out)
  console.log(`wrote ${OUTPUT}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
