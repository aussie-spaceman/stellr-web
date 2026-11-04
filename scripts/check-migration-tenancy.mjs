/**
 * check-migration-tenancy.mjs — every table is classified, and every tenant-
 * or event-scoped table carries its tenant (multi-tenancy plan S3).
 *
 * Runs under `npm run lint:migrations` and in `prebuild`, beside
 * check-migration-names.mjs and check-migration-security.mjs, so a migration
 * that breaks a rule fails CI and the build.
 *
 * The table inventory is read from the repo — supabase/baseline.sql plus every
 * timestamped migration, oldest first (scripts/lib/schema-tables.mjs) — and
 * compared with lib/tenancy/registry.ts. It fails when:
 *
 *   1. a table exists that the registry does not classify (a new migration's
 *      CREATE TABLE needs a registry entry in the same change), or the
 *      registry names a table that no longer exists;
 *   2. a registry entry is inconsistent (e.g. an event_scoped table with
 *      tenantColumn 'none', a via_parent table without a parent);
 *   3. an `own` or `derived` table lacks a tenant_id column, an index led by
 *      tenant_id, or row level security;
 *   4. a `derived` table lacks its event key column or the
 *      zz_tenancy_derive_tenant_id trigger with matching arguments;
 *   5. a table has an event key column (event_slug, event_ref,
 *      sanity_event_id) but is not classified event_scoped / derived — the
 *      shape of a new event table that forgot its tenant;
 *   6. a table created by S3 or later is tenant/event-scoped through a parent
 *      (via_parent is a transition state for pre-S3 tables only);
 *   7. any table lacks row level security;
 *   8. the derivation trigger on a derived table is disabled;
 *   9. a migration at or after S3 uses a statement the inventory cannot
 *      follow — CREATE TABLE … AS / PARTITION OF / OF type / INHERITS,
 *      SELECT … INTO, a materialized view, DDL inside a DO block or function
 *      (EXECUTE or static), session_replication_role, ALTER TRIGGER, ALTER
 *      TABLE … SET SCHEMA / INHERIT / ATTACH PARTITION, dropping a tenant_id
 *      index, or a trigger it disables and never re-enables. The lint fails
 *      closed: such a statement fails unless UNPARSED_ALLOWLIST names its
 *      file and kind, with the reason it is safe.
 *
 * Dependency-free (Node runs the .ts registry directly).
 */
import { pathToFileURL } from 'node:url'
import { readSchemaInventory, TIMESTAMPED } from './lib/schema-tables.mjs'
import { TABLE_REGISTRY, EVENT_KEY_COLUMNS, entryProblems } from '../lib/tenancy/registry.ts'
import { S3_FIRST_MIGRATION } from '../lib/tenancy/constants.ts'

export const DERIVE_TRIGGER = 'zz_tenancy_derive_tenant_id'
export const DERIVE_FUNCTION = 'public.tenancy_derive_tenant_id'

/**
 * Statements the inventory cannot follow that a reviewer has checked by hand.
 * Key: migration file name. Value: { kind: reason }. Keep it short — every
 * entry is a place the lint is blind.
 */
export const UNPARSED_ALLOWLIST = {
  '20261104140000_tenant_id_backfill.sql': {
    'ddl-in-plpgsql':
      "tenancy_backfill_tenant_ids() switches each derived table's enabled triggers off for its UPDATE and back on in their original mode; " +
      'it creates no table and touches no RLS. pgTAP section 6 (tenancy.test.sql) checks the triggers are enabled again.',
  },
}

/** Problems for the unfollowable statements in `issues`, minus the allowlisted ones. */
export function unparsedProblems(issues, allowlist = UNPARSED_ALLOWLIST) {
  return issues
    .filter((i) => !allowlist[i.source]?.[i.kind])
    .map((i) => `${i.source}: ${i.kind} — the tenancy lint cannot follow this statement, so it fails closed: ${i.statement}`)
}

/** True when the table was created by a migration at or after S3. */
export function createdSinceS3(source) {
  return TIMESTAMPED.test(source ?? '') && source.slice(0, 14) >= S3_FIRST_MIGRATION
}

/**
 * @param {Map<string, {name: string, source: string, columns: Set<string>, rls: boolean, indexed: Set<string>, triggers: Map<string, {function: string, args: string[]}>}>} tables
 * @param {Record<string, import('../lib/tenancy/registry.ts').TableEntry>} registry
 * @param {{source: string, kind: string, statement: string}[]} issues  from readSchemaInventory / applySql strict mode
 * @returns {string[]} problems
 */
export function checkTenancy(tables, registry = TABLE_REGISTRY, issues = [], allowlist = UNPARSED_ALLOWLIST) {
  const problems = unparsedProblems(issues, allowlist)

  for (const [name, t] of tables) {
    const entry = registry[name]
    if (!t.rls) problems.push(`${name}: row level security is not enabled (${t.source})`)
    if (!entry) {
      problems.push(`${name}: not classified in lib/tenancy/registry.ts (created by ${t.source})`)
      continue
    }

    for (const p of entryProblems(name, entry, registry)) problems.push(p)

    if (entry.tenantColumn === 'own' || entry.tenantColumn === 'derived') {
      if (!t.columns.has('tenant_id')) problems.push(`${name}: ${entry.tenantColumn} but has no tenant_id column`)
      else if (!t.indexed.has('tenant_id')) problems.push(`${name}: tenant_id has no index led by it`)
    }

    if (entry.tenantColumn === 'derived' && entry.eventKey) {
      const { column, kind } = entry.eventKey
      if (!t.columns.has(column)) problems.push(`${name}: event key column ${column} does not exist`)
      const trg = t.triggers.get(DERIVE_TRIGGER)
      if (!trg || trg.function !== DERIVE_FUNCTION) {
        problems.push(`${name}: derived but has no ${DERIVE_TRIGGER} trigger calling ${DERIVE_FUNCTION}`)
      } else if (trg.args[0] !== column || (trg.args[1] ?? 'slug') !== kind) {
        problems.push(`${name}: ${DERIVE_TRIGGER} arguments (${trg.args.join(', ')}) do not match eventKey (${column}, ${kind})`)
      } else if (trg.enabled === false) {
        problems.push(`${name}: ${DERIVE_TRIGGER} is disabled`)
      }
    }

    const keyCols = [...t.columns].filter((c) => Object.hasOwn(EVENT_KEY_COLUMNS, c))
    if (keyCols.length && !(entry.class === 'event_scoped' && entry.tenantColumn === 'derived')) {
      problems.push(`${name}: has event key column ${keyCols.join(', ')} but is not event_scoped with a derived tenant_id`)
    }

    if (
      createdSinceS3(t.source) &&
      (entry.class === 'tenant_scoped' || entry.class === 'event_scoped') &&
      entry.tenantColumn === 'via_parent'
    ) {
      problems.push(`${name}: created since S3 (${t.source}) — needs its own tenant_id ('own' or 'derived'), not via_parent`)
    }
  }

  for (const name of Object.keys(registry)) {
    if (!tables.has(name)) problems.push(`${name}: in the registry but no migration creates it (dropped or renamed?)`)
  }

  return problems
}

function main() {
  const { tables, issues } = readSchemaInventory('.', S3_FIRST_MIGRATION)
  const problems = checkTenancy(tables, TABLE_REGISTRY, issues)
  if (problems.length) {
    console.error('\n✗ migration tenancy\n')
    for (const p of problems) console.error(`  ${p}`)
    console.error(
      '\n  Every table is classified in lib/tenancy/registry.ts. A tenant- or\n' +
        '  event-scoped table needs tenant_id, an index on it and RLS; one with an\n' +
        '  event key also needs the zz_tenancy_derive_tenant_id trigger. See\n' +
        '  docs/TENANCY-S3.md.\n',
    )
    process.exit(1)
  }
  const scoped = [...tables.keys()].filter((n) => ['tenant_scoped', 'event_scoped'].includes(TABLE_REGISTRY[n]?.class)).length
  console.log(`✓ migration tenancy: ${tables.size} tables classified, ${scoped} tenant/event-scoped`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
