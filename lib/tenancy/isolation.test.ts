// @vitest-environment node
//
// S4 database-enforced isolation: the generated cross-tenant pgTAP matrix is
// current and covers every tenant table, and the tenancy lint demands the
// tenant policies on every own/derived table.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TABLE_REGISTRY, type TableEntry } from './registry'
import {
  generate,
  OUTPUT,
  FIXTURES,
  fixtureProblems,
  tenantTables,
  viaParentTables,
  TENANT_ROLE,
} from '../../scripts/gen-tenant-isolation-pgtap.mjs'
import { isolationPolicyProblems, ISOLATION_POLICIES, S4_FIRST_MIGRATION } from '../../scripts/check-migration-tenancy.mjs'
import { schemaSources, readSchemaInventory } from '../../scripts/lib/schema-tables.mjs'
import {
  TENANT_APP_NO_ACCESS_TABLES,
  TENANT_APP_READ_ONLY_TABLES,
  TENANT_PARENT_REFS,
  SELF_REF_TABLES,
  guardWithCheck,
} from './tenant-role'

const MIGRATION = 'supabase/migrations/20261104200000_tenant_isolation_policies.sql'

describe('cross-tenant pgTAP matrix (S4)', () => {
  it('supabase/tests/database/tenant_isolation.test.sql is up to date', () => {
    // Stale? node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/gen-tenant-isolation-pgtap.mjs
    expect(readFileSync(OUTPUT, 'utf8')).toBe(generate())
  })

  it('has a fixture for every own/derived tenant table, and none for anything else', () => {
    expect(fixtureProblems()).toEqual([])
    expect(tenantTables().length).toBe(35)
    expect(Object.keys(FIXTURES).sort()).toEqual(tenantTables())
  })

  it('every non-tenant table that carries tenant_id is listed in TENANT_APP_NO_ACCESS_TABLES (and the matrix asserts tenant_app has no grant)', () => {
    const { tables } = readSchemaInventory('.')
    const withTenantId = [...tables.entries()]
      .filter(([name, t]) => t.columns.has('tenant_id') && TABLE_REGISTRY[name]?.tenantColumn === 'none')
      .map(([name]) => name)
      .sort()
    expect(withTenantId).toEqual(Object.keys(TENANT_APP_NO_ACCESS_TABLES).sort())
    const sql = generate()
    for (const n of Object.keys(TENANT_APP_NO_ACCESS_TABLES)) {
      expect(sql).toContain(`NOT has_table_privilege('${TENANT_ROLE}', '${n}', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')`)
    }
  })

  it('refuses to generate when a tenant table has no fixture (a new table cannot slip past the matrix)', () => {
    const registry: Record<string, TableEntry> = {
      ...TABLE_REGISTRY,
      'public.new_event_table': { class: 'event_scoped', tenantColumn: 'derived', eventKey: { column: 'event_slug', kind: 'slug' } },
    }
    expect(() => generate(registry)).toThrow(/public\.new_event_table: tenant table with no fixture/)
  })

  it('asserts every check for both tenants on every tenant table, with counts', () => {
    const sql = readFileSync(OUTPUT, 'utf8')
    for (const t of tenantTables()) {
      for (const label of ['Stellr', 'canary']) {
        expect(sql, `${t} ${label}`).toContain(`${label} context: sees exactly its own rows of ${t}`)
        expect(sql, `${t} ${label}`).toContain(`${label} context: INSERT of a ${label === 'Stellr' ? 'canary' : 'Stellr'} row into ${t} is refused by RLS`)
      }
      expect(sql).toContain(`${t}: both tenants have rows (the matrix cannot pass on an empty table)`)
      expect(sql).toContain(`no tenant pinned: sees 0 rows of ${t}`)
    }
    // tenant_app cannot call pgTAP; every assertion runs after RESET ROLE.
    const plan = Number(/SELECT plan\((\d+)\)/.exec(sql)?.[1])
    expect(plan).toBeGreaterThan(700)
    expect(sql).toContain('SET LOCAL row_security = on;')
  })

  it('keeps the via_parent child tables (no tenant_id yet) out of reach of the tenant role', () => {
    const sql = readFileSync(OUTPUT, 'utf8')
    for (const t of viaParentTables()) expect(sql).toContain(`${t}: no tenant_id yet (via_parent), so ${TENANT_ROLE} has no privilege on it at all`)
    const migration = readFileSync(MIGRATION, 'utf8')
    for (const t of viaParentTables()) expect(migration).not.toMatch(new RegExp(`ON ${t.replace('.', '\\.')} TO tenant_app`))
  })
})

describe('the S4 migration and the tenancy lint', () => {
  it('writes both tenant policies, TO tenant_app only, for every own/derived table', () => {
    const migration = readFileSync(MIGRATION, 'utf8')
    for (const t of tenantTables()) {
      expect(migration).toContain(`CREATE POLICY tenant_isolation ON ${t} AS PERMISSIVE FOR ALL TO tenant_app`)
      expect(migration).toContain(`CREATE POLICY tenant_isolation_guard ON ${t} AS RESTRICTIVE FOR ALL TO tenant_app`)
      if (TENANT_APP_READ_ONLY_TABLES.includes(t)) {
        expect(migration).toContain(`GRANT SELECT ON ${t} TO tenant_app;`)
        expect(migration).not.toMatch(new RegExp(`GRANT [^;]*(?:INSERT|UPDATE|DELETE)[^;]* ON ${t.replace('.', '\\.')} TO tenant_app`))
      } else {
        expect(migration).toContain(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO tenant_app;`)
      }
    }
    const code = migration.replace(/--[^\n]*/g, '')
    expect(code).not.toMatch(/FORCE\s+ROW\s+LEVEL\s+SECURITY/i)
    expect(code.match(/CREATE\s+ROLE[^;]*/gi)).toEqual(['CREATE ROLE tenant_app NOLOGIN NOINHERIT NOBYPASSRLS'])
    expect(code).not.toMatch(/SECURITY\s+DEFINER/i)
    expect(code).not.toMatch(/ALTER\s+ROLE/i)
  })

  it("each guard's WITH CHECK is exactly what lib/tenancy/tenant-role.ts says (event key and every parent key confined to the tenant)", () => {
    const migration = readFileSync(MIGRATION, 'utf8')
    const via = new Set(viaParentTables())
    for (const t of tenantTables()) {
      const block = `CREATE POLICY tenant_isolation_guard ON ${t} AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (${guardWithCheck(t, TABLE_REGISTRY[t], via)});`
      expect(migration, t).toContain(block)
    }
    // A cross-tenant reference is the case the guard exists for: spot-check two.
    expect(guardWithCheck('public.group_join_tokens', TABLE_REGISTRY['public.group_join_tokens'], via)).toContain(
      'EXISTS (SELECT 1 FROM public.registrations p WHERE p.id = group_join_tokens.registration_id)',
    )
    expect(guardWithCheck('public.training_assignments', TABLE_REGISTRY['public.training_assignments'], via)).toContain(
      'EXISTS (SELECT 1 FROM public.training_modules p WHERE p.id = training_assignments.module_id)',
    )
  })

  it('every parent ref is between tenant tables, and the self-ref helper covers exactly the self-referencing tables', () => {
    const tenantish = new Set([...tenantTables(), ...viaParentTables()])
    for (const r of TENANT_PARENT_REFS) {
      expect(tenantTables(), r.table).toContain(r.table)
      expect(tenantish.has(r.parent), r.parent).toBe(true)
    }
    const migration = readFileSync(MIGRATION, 'utf8')
    const fn = /CREATE OR REPLACE FUNCTION public\.tenant_self_ref_visible[\s\S]*?\$\$;/.exec(migration)?.[0] ?? ''
    const cases = [...fn.matchAll(/WHEN '(\w+)' THEN EXISTS \(SELECT 1 FROM public\.(\w+) WHERE id = p_id\)/g)]
    expect(cases.map((m) => m[1])).toEqual(cases.map((m) => m[2]))
    expect(cases.map((m) => `public.${m[1]}`)).toEqual([...SELF_REF_TABLES])
    expect(fn).toMatch(/SECURITY INVOKER/)
    expect(fn).toMatch(/SET search_path = public, pg_temp/)
  })

  it('the lint passes on the real migrations', () => {
    expect(isolationPolicyProblems(schemaSources('.'))).toEqual([])
  })

  it('the lint fails when a tenant table loses a policy, or a new one never gets them', () => {
    const sources = schemaSources('.')
    const dropped = [...sources, { name: '20261104299999_x.sql', sql: 'DROP POLICY IF EXISTS tenant_isolation_guard ON public.registrations;' }]
    expect(isolationPolicyProblems(dropped)).toEqual([
      'public.registrations: derived tenant table without the tenant_isolation_guard policy TO tenant_app (see docs/TENANCY-S4.md)',
    ])
    const registry: Record<string, TableEntry> = {
      ...TABLE_REGISTRY,
      'public.new_event_table': { class: 'event_scoped', tenantColumn: 'derived', eventKey: { column: 'event_slug', kind: 'slug' } },
    }
    expect(isolationPolicyProblems(sources, registry)).toEqual(
      ISOLATION_POLICIES.map((p) => `public.new_event_table: derived tenant table without the ${p} policy TO tenant_app (see docs/TENANCY-S4.md)`),
    )
  })

  it('ignores policy names inside comments, and does not apply before S4 exists', () => {
    const sources = schemaSources('.').filter((s) => !/^\d{14}/.test(s.name) || s.name.slice(0, 14) < S4_FIRST_MIGRATION)
    expect(isolationPolicyProblems(sources)).toEqual([])
    const commented = [
      ...sources,
      { name: `${S4_FIRST_MIGRATION}_c.sql`, sql: '-- CREATE POLICY tenant_isolation ON public.registrations\nSELECT 1;' },
    ]
    expect(isolationPolicyProblems(commented).length).toBe(tenantTables().length * 2)
  })
})
