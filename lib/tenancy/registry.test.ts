// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { TABLE_REGISTRY, derivedTables, entryProblems, type TableEntry } from './registry'
import { STELLR_TENANT_ID } from './constants'
import { readSchemaTables, applySql } from '../../scripts/lib/schema-tables.mjs'
import { checkTenancy } from '../../scripts/check-migration-tenancy.mjs'
import { generate, OUTPUT } from '../../scripts/gen-tenancy-pgtap.mjs'

type Table = {
  name: string
  source: string
  columns: Set<string>
  rls: boolean
  indexed: Set<string>
  triggers: Map<string, { function: string; args: string[] }>
}

const tables: Map<string, Table> = readSchemaTables()

describe('table registry (S3)', () => {
  it('reads a plausible schema: at least the baseline\'s 112 tables plus the S3 ones', () => {
    expect(tables.size).toBeGreaterThanOrEqual(112 + 7)
    for (const t of ['public.members', 'public.registrations', 'public.participants', 'public.agreements', 'public.tenants', 'public.events']) {
      expect(tables.has(t), t).toBe(true)
    }
    // Renamed by 20261002213222 — the old names must be gone.
    expect(tables.has('public.docusign_envelopes')).toBe(false)
  })

  it('classifies every table created across baseline.sql + timestamped migrations, and nothing else', () => {
    const created = [...tables.keys()].sort()
    const registered = Object.keys(TABLE_REGISTRY).sort()
    expect(created.filter((t) => !TABLE_REGISTRY[t])).toEqual([])
    expect(registered.filter((t) => !tables.has(t))).toEqual([])
  })

  it('the generated pgTAP test (supabase/tests/database/tenancy.test.sql) is up to date', () => {
    // Stale? node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/gen-tenancy-pgtap.mjs
    expect(readFileSync(OUTPUT, 'utf8')).toBe(generate())
  })

  it('has internally consistent entries', () => {
    const problems = Object.entries(TABLE_REGISTRY).flatMap(([t, e]) => entryProblems(t, e))
    expect(problems).toEqual([])
  })

  it('passes the migration tenancy lint on the real schema', () => {
    expect(checkTenancy(tables)).toEqual([])
  })

  it('derives tenant_id on exactly the tables that carry an event key', () => {
    const withKey = [...tables.values()]
      .filter((t) => ['event_slug', 'event_ref', 'sanity_event_id'].some((c) => t.columns.has(c)))
      .map((t) => t.name)
      .sort()
    expect(derivedTables().map((d) => d.table)).toEqual(withKey)
    // ~27 event_slug tables plus the 5 Sanity-id tables (plan S3).
    expect(derivedTables().filter((d) => d.kind === 'slug')).toHaveLength(27)
    expect(derivedTables().filter((d) => d.kind === 'sanity_id')).toHaveLength(5)
  })

  it('lists the same tables in the expand and backfill migrations as the registry', () => {
    const dir = 'supabase/migrations'
    const expand = readFileSync(`${dir}/20261104130000_tenant_id_expand.sql`, 'utf8')
    const backfill = readFileSync(`${dir}/20261104140000_tenant_id_backfill.sql`, 'utf8')
    const fromExpand = [...expand.matchAll(/ADD COLUMN IF NOT EXISTS tenant_id[^;]*;\s*\n?/g)].length
    expect(fromExpand).toBe(derivedTables().length)
    const tuples = [...backfill.matchAll(/\('([a-z_]+)', '([a-z_]+)', '(slug|sanity_id)'\)/g)].map((m) => ({
      table: `public.${m[1]}`,
      column: m[2],
      kind: m[3],
    }))
    expect(tuples.sort((a, b) => a.table.localeCompare(b.table))).toEqual(derivedTables())
  })

  it('hard-codes the same Stellr tenant id in every S3 migration as lib/tenancy/constants.ts', () => {
    const s3 = readdirSync('supabase/migrations').filter((f) => f >= '20261104100000' && f < '20261104200000')
    expect(s3.length).toBeGreaterThanOrEqual(5)
    const ids = new Set<string>()
    for (const f of s3) {
      const sql = readFileSync(`supabase/migrations/${f}`, 'utf8')
      for (const m of sql.matchAll(/'(00000000-0000-4000-8000-[0-9a-f]{12})'/g)) ids.add(m[1])
    }
    expect([...ids]).toEqual([STELLR_TENANT_ID])
  })
})

describe('checkTenancy — each rule can fail', () => {
  const base = (): Map<string, Table> => {
    const m = new Map<string, Table>()
    applySql(
      m,
      `CREATE TABLE public.parent_t (id uuid primary key, event_slug text, tenant_id uuid);
       CREATE INDEX parent_t_tenant_id_idx ON public.parent_t (tenant_id);
       ALTER TABLE public.parent_t ENABLE ROW LEVEL SECURITY;
       CREATE TRIGGER zz_tenancy_derive_tenant_id BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.parent_t
         FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');`,
      'supabase/baseline.sql',
    )
    return m
  }
  const reg = (extra: Record<string, TableEntry> = {}): Record<string, TableEntry> => ({
    'public.parent_t': { class: 'event_scoped', tenantColumn: 'derived', eventKey: { column: 'event_slug', kind: 'slug' } },
    ...extra,
  })

  it('a well-formed derived table passes', () => {
    expect(checkTenancy(base(), reg())).toEqual([])
  })

  it('flags a new table missing from the registry', () => {
    const t = base()
    applySql(t, 'CREATE TABLE public.new_thing (id uuid); ALTER TABLE public.new_thing ENABLE ROW LEVEL SECURITY;', '20261201000000_x.sql')
    expect(checkTenancy(t, reg()).join('\n')).toMatch(/new_thing: not classified/)
  })

  it('flags a registry entry with no table', () => {
    expect(checkTenancy(base(), reg({ 'public.ghost': { class: 'system', tenantColumn: 'none' } })).join('\n')).toMatch(/ghost: in the registry but no migration/)
  })

  it('flags a table without RLS', () => {
    const t = base()
    applySql(t, 'CREATE TABLE public.open_t (id uuid);', '20261201000000_x.sql')
    expect(checkTenancy(t, reg({ 'public.open_t': { class: 'system', tenantColumn: 'none' } })).join('\n')).toMatch(/open_t: row level security/)
  })

  it('flags a new event table with an event key but no tenant_id, index or trigger', () => {
    const t = base()
    applySql(t, 'CREATE TABLE public.ev_t (id uuid, event_slug text); ALTER TABLE public.ev_t ENABLE ROW LEVEL SECURITY;', '20261201000000_x.sql')
    const asDerived = checkTenancy(t, reg({ 'public.ev_t': { class: 'event_scoped', tenantColumn: 'derived', eventKey: { column: 'event_slug', kind: 'slug' } } })).join('\n')
    expect(asDerived).toMatch(/ev_t: derived but has no tenant_id column/)
    expect(asDerived).toMatch(/ev_t: derived but has no zz_tenancy_derive_tenant_id trigger/)
    const asSystem = checkTenancy(t, reg({ 'public.ev_t': { class: 'system', tenantColumn: 'none' } })).join('\n')
    expect(asSystem).toMatch(/ev_t: has event key column event_slug but is not event_scoped/)
  })

  it('flags tenant_id without an index', () => {
    const t = base()
    applySql(t, 'CREATE TABLE public.own_t (id uuid, tenant_id uuid not null); ALTER TABLE public.own_t ENABLE ROW LEVEL SECURITY;', '20261201000000_x.sql')
    expect(checkTenancy(t, reg({ 'public.own_t': { class: 'tenant_scoped', tenantColumn: 'own' } })).join('\n')).toMatch(/own_t: tenant_id has no index/)
  })

  it('flags a trigger whose arguments disagree with the registry', () => {
    const r = reg()
    r['public.parent_t'] = { class: 'event_scoped', tenantColumn: 'derived', eventKey: { column: 'event_slug', kind: 'sanity_id' } }
    expect(checkTenancy(base(), r).join('\n')).toMatch(/arguments \(event_slug, slug\) do not match/)
  })

  it('refuses via_parent for a table created since S3, allows it for a pre-S3 table', () => {
    const t = base()
    applySql(t, 'CREATE TABLE public.kid_t (id uuid); ALTER TABLE public.kid_t ENABLE ROW LEVEL SECURITY;', '20261201000000_x.sql')
    applySql(t, 'CREATE TABLE public.old_kid (id uuid); ALTER TABLE public.old_kid ENABLE ROW LEVEL SECURITY;', '20261001000000_x.sql')
    const problems = checkTenancy(
      t,
      reg({
        'public.kid_t': { class: 'event_scoped', tenantColumn: 'via_parent', parent: 'public.parent_t' },
        'public.old_kid': { class: 'event_scoped', tenantColumn: 'via_parent', parent: 'public.parent_t' },
      }),
    ).join('\n')
    expect(problems).toMatch(/kid_t: created since S3/)
    expect(problems).not.toMatch(/old_kid/)
  })

  it('follows renames and drops', () => {
    const t = base()
    applySql(t, 'CREATE TABLE public.a_t (id uuid); ALTER TABLE public.a_t RENAME TO b_t; CREATE TABLE public.c_t (id uuid); DROP TABLE IF EXISTS public.c_t;', 'x.sql')
    expect(t.has('public.a_t')).toBe(false)
    expect(t.has('public.b_t')).toBe(true)
    expect(t.has('public.c_t')).toBe(false)
  })
})
