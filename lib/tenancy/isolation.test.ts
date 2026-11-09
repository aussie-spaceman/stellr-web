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
  TENANT_APP_UNWRITABLE_COLUMNS,
  TENANT_PARENT_REFS,
  SELF_REF_TABLES,
  guardWithCheck,
} from './tenant-role'

const MIGRATION = 'supabase/migrations/20261104200000_tenant_isolation_policies.sql'
/** S5 C0b: the 10 child tables, and the guards that used to hold a key to them to NULL. */
const CHILD_MIGRATION = 'supabase/migrations/20261106070726_via_parent_tenant_policies.sql'
/** Child tables created after C0b, each writing its own policies (and carry) in its CREATE TABLE migration. */
const LATER_CHILD_MIGRATIONS: Record<string, string> = {
  'public.agreement_email_changes': 'supabase/migrations/20261109200000_agreement_email_changes.sql',
}
const inheritedTenantTables = () => tenantTables().filter((t) => TABLE_REGISTRY[t].tenantColumn === 'inherited')
/** The S4 file for a table it wrote, the C0b file for a child table, or the later child's own. */
const policyFileFor = (t: string) =>
  readFileSync(LATER_CHILD_MIGRATIONS[t] ?? (TABLE_REGISTRY[t].tenantColumn === 'inherited' ? CHILD_MIGRATION : MIGRATION), 'utf8')
/** A table's guard as the migrations leave it: the last one written wins. */
function lastGuard(t: string): string {
  const all = [MIGRATION, CHILD_MIGRATION, ...Object.values(LATER_CHILD_MIGRATIONS)].map((f) => readFileSync(f, 'utf8')).join('\n')
  const from = all.lastIndexOf(`CREATE POLICY tenant_isolation_guard ON ${t} AS RESTRICTIVE`)
  return all.slice(from, all.indexOf(';', from) + 1)
}

describe('cross-tenant pgTAP matrix (S4)', () => {
  it('supabase/tests/database/tenant_isolation.test.sql is up to date', () => {
    // Stale? node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/gen-tenant-isolation-pgtap.mjs
    expect(readFileSync(OUTPUT, 'utf8')).toBe(generate())
  })

  it('has a fixture for every own/derived/inherited tenant table, and none for anything else', () => {
    expect(fixtureProblems()).toEqual([])
    expect(tenantTables().length).toBe(46)
    expect(inheritedTenantTables().length).toBe(11)
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

  it('still keeps a table with no tenant_id out of reach of the tenant role, should one ever be via_parent', () => {
    expect(viaParentTables()).toEqual([])
    const registry: Record<string, TableEntry> = {
      ...TABLE_REGISTRY,
      'public.schools': { class: 'event_scoped', tenantColumn: 'via_parent', parent: 'public.registrations' },
    }
    expect(viaParentTables(registry)).toEqual(['public.schools'])
    expect(generate(registry)).toContain(`public.schools: no tenant_id yet (via_parent), so ${TENANT_ROLE} has no privilege on it at all`)
  })

  it('covers every child table, and refuses tenant_app any write to the append-only ones', () => {
    const sql = readFileSync(OUTPUT, 'utf8')
    for (const t of inheritedTenantTables()) expect(sql, t).toContain(`canary context: sees exactly its own rows of ${t}`)
    for (const t of ['public.agreement_recipients', 'public.esign_access_log', 'public.esign_audit_events', 'public.survey_answers']) {
      expect(TENANT_APP_READ_ONLY_TABLES).toContain(t)
      expect(sql, t).toContain(`canary context: cannot INSERT into ${t} (read-only to ${TENANT_ROLE}; platform code writes it)`)
    }
  })

  it('refuses tenant_app the identity columns of participants, and keeps the other columns writable', () => {
    const sql = readFileSync(OUTPUT, 'utf8')
    expect(TENANT_APP_UNWRITABLE_COLUMNS['public.participants']).toEqual(['member_id', 'membership_id'])
    for (const col of TENANT_APP_UNWRITABLE_COLUMNS['public.participants']) {
      expect(sql).toContain(`public.participants.${col}: ${TENANT_ROLE} may read it but not write it`)
      expect(sql).toContain(`Stellr context: UPDATE of public.participants.${col} is refused`)
      expect(sql).toContain(`canary context: INSERT into public.participants naming ${col} is refused`)
    }
    expect(sql).toContain('canary context: its other columns of public.participants stay writable')
  })

  it('section 7: another tenant\'s parent and a missing one get the same refusal, in both modes, on every writable child table', () => {
    const sql = readFileSync(OUTPUT, 'utf8')
    const writable = inheritedTenantTables().filter((t) => !TENANT_APP_READ_ONLY_TABLES.includes(t))
    expect(writable).toHaveLength(6)
    for (const mode of ['log', 'enforce']) {
      for (const who of ['Stellr', 'canary']) {
        for (const t of writable) {
          for (const chk of ['insert_foreign_omitted', 'insert_missing_omitted', 'insert_foreign_supplied', 'insert_missing_supplied', 'update_foreign', 'update_missing']) {
            expect(sql, `${mode} ${who} ${t} ${chk}`).toContain(`${mode} mode, ${who} context: ${t} ${chk} gets RLS's one refusal`.replace(/'/g, "''"))
          }
        }
        for (const chk of ['under_age_foreign', 'null_dob_foreign', 'under_age_update_foreign']) {
          expect(sql).toContain(`${mode} mode, ${who} context: participants ${chk} gets RLS''s refusal, not an eligibility reason`)
        }
      }
      expect(sql).toContain(`${mode} mode, canary context: an under-age participant on its own event is still refused by eligibility`)
    }
  })
})

describe('the triggers that read a parent, in a tenant session', () => {
  const EXPAND = readFileSync('supabase/migrations/20261106070722_via_parent_tenant_expand.sql', 'utf8')
  const body = (fn: string) => new RegExp(`FUNCTION public\\.${fn}\\([\\s\\S]*?END \\$\\$;`).exec(EXPAND)?.[0] ?? ''

  it('asks whether the session can see the parent before anything can raise', () => {
    for (const [fn, call] of [
      ['participants_assert_eligible', 'tenancy_hidden_from_tenant_session(reg.tenant_id, NULL)'],
      ['registrations_assert_eligible', 'tenancy_hidden_from_tenant_session(NEW.tenant_id, NEW.event_slug)'],
      ['tenancy_inherit_tenant_id', 'tenancy_hidden_from_tenant_session(CASE WHEN has_parent THEN derived END, NULL)'],
    ]) {
      const code = body(fn)
      const asked = code.indexOf(call)
      expect(asked, fn).toBeGreaterThan(-1)
      expect(code.indexOf('RAISE EXCEPTION'), fn).toBeGreaterThan(asked)
    }
  })

  it('answers false for every other session on its first line, so nothing changes for service_role', () => {
    const code = body('tenancy_hidden_from_tenant_session')
    expect(code).toMatch(/BEGIN\s+IF COALESCE\(current_setting\('role', true\), ''\) <> 'tenant_app' THEN\s+RETURN false;/)
  })

  it('only the two eligibility triggers changed from the A3 migration', () => {
    const a3 = readFileSync('supabase/migrations/20261105041211_participants_eligibility.sql', 'utf8')
    const a3Body = (fn: string) => new RegExp(`FUNCTION public\\.${fn}\\([\\s\\S]*?END \\$\\$;`).exec(a3)?.[0] ?? ''
    const stepAside = /\n\s*IF public\.tenancy_hidden_from_tenant_session\([^\n]*\n\s*RETURN NEW;\n\s*END IF;\n/
    for (const fn of ['participants_assert_eligible', 'registrations_assert_eligible']) {
      expect(body(fn).replace(stepAside, '\n').replace(/\s+/g, ' '), fn).toBe(a3Body(fn).replace(/\s+/g, ' '))
    }
  })
})

describe('a parent that changes tenant', () => {
  const CARRY = readFileSync('supabase/migrations/20261106074112_via_parent_tenant_carry.sql', 'utf8')
  const CARRY_PATTERN = /AFTER UPDATE ON public\.(\w+)\s+FOR EACH ROW\s+WHEN \(([^\n]*)\)\s+EXECUTE FUNCTION public\.tenancy_carry_children\(([^)]*)\)/g
  // A later child's migration re-creates its parent's trigger with the child added: the last one per parent wins.
  const triggers = [
    ...new Map(
      [CARRY, ...Object.values(LATER_CHILD_MIGRATIONS).map((f) => readFileSync(f, 'utf8'))]
        .flatMap((sql) => [...sql.matchAll(CARRY_PATTERN)])
        .map((m) => [m[1], m] as const),
    ).values(),
  ]

  it('carries every child table, by the key the registry names', () => {
    const carried = triggers.flatMap(([, parent, , args]) => {
      const a = args.split(',').map((s) => s.trim().replace(/'/g, ''))
      return a.flatMap((v, i) => (i % 2 === 0 ? [`public.${v}|${a[i + 1]}|public.${parent}`] : []))
    })
    const want = inheritedTenantTables().map((t) => `${t}|${TABLE_REGISTRY[t].parentKey}|${TABLE_REGISTRY[t].parent}`)
    expect(carried.sort()).toEqual(want.sort())
  })

  it('fires only on a move from one tenant to another, so Stellr and a backfill never reach it', () => {
    expect(triggers).toHaveLength(7)
    for (const [, parent, when] of triggers) {
      expect(when, parent).toBe('OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT NULL AND OLD.tenant_id <> NEW.tenant_id')
    }
    // Not UPDATE OF: a registration changes tenant when the derivation trigger rewrites it.
    expect(CARRY.replace(/--[^\n]*/g, '')).not.toMatch(/AFTER UPDATE OF/)
  })
})

describe('the S4 migration and the tenancy lint', () => {
  it('writes both tenant policies, TO tenant_app only, for every own/derived/inherited table', () => {
    for (const t of tenantTables()) {
      const migration = policyFileFor(t)
      expect(migration).toContain(`CREATE POLICY tenant_isolation ON ${t} AS PERMISSIVE FOR ALL TO tenant_app`)
      expect(migration).toContain(`CREATE POLICY tenant_isolation_guard ON ${t} AS RESTRICTIVE FOR ALL TO tenant_app`)
      if (TENANT_APP_READ_ONLY_TABLES.includes(t)) {
        expect(migration).toContain(`GRANT SELECT ON ${t} TO tenant_app;`)
        expect(migration).not.toMatch(new RegExp(`GRANT [^;]*(?:INSERT|UPDATE|DELETE)[^;]* ON ${t.replace('.', '\\.')} TO tenant_app`))
      } else if (TENANT_APP_UNWRITABLE_COLUMNS[t]) {
        // Whole-table INSERT or UPDATE would take in the columns it must not write.
        expect(migration).toContain(`GRANT SELECT, DELETE ON ${t} TO tenant_app;`)
        expect(migration).not.toMatch(new RegExp(`GRANT [^;(]*\\b(?:INSERT|UPDATE)\\b[^;(]* ON ${t.replace('.', '\\.')} TO tenant_app`))
        expect(migration).toContain(`GRANT INSERT (%1$s), UPDATE (%1$s) ON ${t} TO tenant_app`)
        expect(migration).toContain(`a.attname NOT IN (${TENANT_APP_UNWRITABLE_COLUMNS[t].map((c) => `'${c}'`).join(', ')})`)
      } else {
        expect(migration).toContain(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO tenant_app;`)
      }
    }
    const code = readFileSync(MIGRATION, 'utf8').replace(/--[^\n]*/g, '')
    expect(code).not.toMatch(/FORCE\s+ROW\s+LEVEL\s+SECURITY/i)
    expect(code.match(/CREATE\s+ROLE[^;]*/gi)).toEqual(['CREATE ROLE tenant_app NOLOGIN NOINHERIT NOBYPASSRLS'])
    expect(code).not.toMatch(/SECURITY\s+DEFINER/i)
    expect(code).not.toMatch(/ALTER\s+ROLE/i)
    const childCode = readFileSync(CHILD_MIGRATION, 'utf8').replace(/--[^\n]*/g, '')
    expect(childCode).not.toMatch(/FORCE\s+ROW\s+LEVEL\s+SECURITY|SECURITY\s+DEFINER|(?:CREATE|ALTER)\s+ROLE/i)
    expect(childCode.match(/TO\s+[a-z_]+/gi)?.every((m) => /TO\s+tenant_app/i.test(m))).toBe(true)
  })

  it("each guard's WITH CHECK is exactly what lib/tenancy/tenant-role.ts says (event key and every parent key confined to the tenant)", () => {
    const via = new Set(viaParentTables())
    for (const t of tenantTables()) {
      const block = `CREATE POLICY tenant_isolation_guard ON ${t} AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (${guardWithCheck(t, TABLE_REGISTRY[t], via)});`
      expect(lastGuard(t), t).toBe(block)
    }
    // No guard still holds a key to a child table to NULL.
    const heldToNull = /AND \w+\.\w+ IS NULL(?! OR)/
    expect(readFileSync(MIGRATION, 'utf8')).toMatch(heldToNull)
    for (const t of tenantTables()) expect(lastGuard(t), t).not.toMatch(heldToNull)
    expect(lastGuard('public.agreements')).toContain('EXISTS (SELECT 1 FROM public.participants p WHERE p.id = agreements.participant_id)')
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
    // A child table's foreign key to its parent is a ref. The two esign logs have none.
    for (const t of inheritedTenantTables()) {
      const e = TABLE_REGISTRY[t]
      const listed = TENANT_PARENT_REFS.some((r) => r.table === t && r.column === e.parentKey && r.parent === e.parent)
      expect([t, listed]).toEqual([t, !e.noForeignKey])
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
