// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { TABLE_REGISTRY, derivedTables, entryProblems, inheritedTables, type TableEntry } from './registry'
import { STELLR_TENANT_ID, S3_FIRST_MIGRATION } from './constants'
import { readSchemaTables, readSchemaInventory, applySql } from '../../scripts/lib/schema-tables.mjs'
import { checkTenancy, UNPARSED_ALLOWLIST } from '../../scripts/check-migration-tenancy.mjs'
import { generate, OUTPUT } from '../../scripts/gen-tenancy-pgtap.mjs'

type Table = {
  name: string
  source: string
  columns: Set<string>
  rls: boolean
  indexed: Set<string>
  triggers: Map<string, { function: string; args: string[]; enabled?: boolean }>
}
type Issue = { source: string; kind: string; statement: string }

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

  it('passes the migration tenancy lint on the real schema, strict mode included', () => {
    expect(checkTenancy(tables)).toEqual([])
    const { tables: strictTables, issues } = readSchemaInventory('.', S3_FIRST_MIGRATION)
    // The only statement S3 itself needs an allowlist for is the backfill's trigger switching.
    expect(issues.map((i: Issue) => `${i.source}:${i.kind}`)).toEqual(['20261104140000_tenant_id_backfill.sql:ddl-in-plpgsql'])
    expect(checkTenancy(strictTables, TABLE_REGISTRY, issues)).toEqual([])
  })

  it('derives tenant_id on exactly the tables that carry an event key', () => {
    const withKey = [...tables.values()]
      .filter((t) => ['event_slug', 'event_ref', 'sanity_event_id'].some((c) => t.columns.has(c)))
      .map((t) => t.name)
      .sort()
    expect(derivedTables().map((d) => d.table)).toEqual(withKey)
    // ~27 event_slug tables plus the 5 Sanity-id tables (plan S3), and the
    // derived tables created since (POST_EXPAND below).
    expect(derivedTables().filter((d) => d.kind === 'slug')).toHaveLength(28)
    expect(derivedTables().filter((d) => d.kind === 'sanity_id')).toHaveLength(5)
  })

  it('expands the same tables as the registry, and the backfill follows the triggers', () => {
    const dir = 'supabase/migrations'
    const expand = readFileSync(`${dir}/20261104130000_tenant_id_expand.sql`, 'utf8')
    const backfill = readFileSync(`${dir}/20261104140000_tenant_id_backfill.sql`, 'utf8')
    const fromExpand = [...expand.matchAll(/ADD COLUMN IF NOT EXISTS tenant_id[^;]*;\s*\n?/g)].length
    // Derived tables created after S3 carry tenant_id, its index and the
    // trigger in their own CREATE TABLE migration (checked by lint:tenancy).
    const POST_EXPAND = new Set(['public.event_crew_check_ins'])
    expect(fromExpand).toBe(derivedTables().filter((d) => !POST_EXPAND.has(d.table)).length)
    // The backfill reads its table list from the catalog (every table with the
    // derivation trigger), so it cannot drift; pgTAP section 6 checks the set.
    expect(backfill).toMatch(/t\.tgname = 'zz_tenancy_derive_tenant_id'/)
    expect(backfill).toMatch(/SELECT tbl, rows_updated FROM public\.tenancy_backfill_tenant_ids\(\);/)
    // The expand migration stamps its real apply time for the 7-day gate.
    expect(expand).toMatch(/SET expand_applied_at = COALESCE\(expand_applied_at, now\(\)\)/)
  })

  it('S5 C0b: expands, backfills and stamps exactly the inherited tables', () => {
    const dir = 'supabase/migrations'
    const expand = readFileSync(`${dir}/20261106070722_via_parent_tenant_expand.sql`, 'utf8')
    const backfill = readFileSync(`${dir}/20261106070724_via_parent_tenant_backfill.sql`, 'utf8')
    const code = (sql: string) => sql.replace(/--[^\n]*/g, '')
    // Inherited tables created after C0b carry tenant_id, its index and the
    // trigger in their own CREATE TABLE migration (checked by lint:tenancy),
    // not in the C0b expand.
    const POST_C0B = new Set(['public.agreement_email_changes'])
    const children = inheritedTables().filter((c) => !POST_C0B.has(c.table))
    expect(children).toHaveLength(10)
    expect(Object.values(TABLE_REGISTRY).filter((e) => e.tenantColumn === 'via_parent')).toEqual([])
    for (const c of children) {
      const name = c.table.split('.')[1]
      const parent = c.parent.split('.')[1]
      expect(code(expand), c.table).toContain(`ALTER TABLE ${c.table}\n  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;`)
      expect(code(expand), c.table).toContain(`CREATE INDEX IF NOT EXISTS ${name}_tenant_id_idx ON ${c.table} (tenant_id);`)
      expect(code(expand), c.table).toContain(
        `BEFORE INSERT OR UPDATE OF ${c.column}, tenant_id ON ${c.table}\n  FOR EACH ROW EXECUTE FUNCTION public.tenancy_inherit_tenant_id('${c.column}', '${parent}');`,
      )
      expect(code(backfill), c.table).toContain(`'${name}'`)
    }
    // Stays expand-only: no NOT NULL, no default, nothing dropped but the trigger it replaces.
    expect(code(expand)).not.toMatch(/\bSET NOT NULL\b|\bDEFAULT\b|\bDROP COLUMN\b|\bDROP CONSTRAINT\b/i)
    expect(code(expand)).toMatch(/SET LOCAL lock_timeout/)
    expect(code(backfill)).toMatch(/SET LOCAL lock_timeout/)
    // The backfill leaves every trigger it switches off on again, in the same file.
    for (const trg of ['esign_audit_events_guard', 'survey_invitations_updated_at']) {
      expect(code(backfill)).toContain(`DISABLE TRIGGER ${trg};`)
      expect(code(backfill)).toContain(`ENABLE TRIGGER ${trg};`)
    }
    // The file holds no second foreign key to a parent, which PostgREST would refuse to embed through.
    expect(code(expand)).not.toMatch(/REFERENCES\s+public\.(?!tenants\b)/i)
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

  describe('an inherited table', () => {
    const entry: TableEntry = { class: 'event_scoped', tenantColumn: 'inherited', parent: 'public.parent_t', parentKey: 'parent_id' }
    const withKid = (ddl: string) => {
      const t = base()
      applySql(t, `CREATE TABLE public.kid_i (id uuid, parent_id uuid, tenant_id uuid); ALTER TABLE public.kid_i ENABLE ROW LEVEL SECURITY; ${ddl}`, '20261001000000_x.sql')
      return checkTenancy(t, reg({ 'public.kid_i': entry })).join('\n')
    }
    const index = 'CREATE INDEX kid_i_tenant_id_idx ON public.kid_i (tenant_id);'
    const trigger = (args: string) =>
      `CREATE TRIGGER zz_tenancy_derive_tenant_id BEFORE INSERT OR UPDATE OF parent_id, tenant_id ON public.kid_i FOR EACH ROW EXECUTE FUNCTION public.tenancy_inherit_tenant_id(${args});`

    it('passes with its column, index and matching trigger', () => {
      expect(withKid(`${index} ${trigger("'parent_id', 'parent_t'")}`)).toBe('')
    })
    it('fails with no index', () => {
      expect(withKid(trigger("'parent_id', 'parent_t'"))).toMatch(/kid_i: tenant_id has no index/)
    })
    it('fails with no trigger, or the event-key trigger instead', () => {
      expect(withKid(index)).toMatch(/kid_i: inherited but has no zz_tenancy_derive_tenant_id trigger/)
      expect(withKid(`${index} CREATE TRIGGER zz_tenancy_derive_tenant_id BEFORE INSERT ON public.kid_i FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('parent_id', 'slug');`)).toMatch(
        /kid_i: inherited but has no zz_tenancy_derive_tenant_id trigger/,
      )
    })
    it('fails when the trigger names another parent', () => {
      expect(withKid(`${index} ${trigger("'parent_id', 'other_t'")}`)).toMatch(/arguments \(parent_id, other_t\) do not match parent \(parent_id, parent_t\)/)
    })
    it('fails when the trigger is disabled', () => {
      expect(withKid(`${index} ${trigger("'parent_id', 'parent_t'")} ALTER TABLE public.kid_i DISABLE TRIGGER zz_tenancy_derive_tenant_id;`)).toMatch(/kid_i: zz_tenancy_derive_tenant_id is disabled/)
    })
    it('entryProblems wants a parent and a parentKey, and keeps them to inherited tables', () => {
      const p = (e: TableEntry) => entryProblems('public.x', e, reg())
      expect(p(entry)).toEqual([])
      expect(p({ ...entry, parentKey: undefined })).toEqual(['public.x: inherited needs a parentKey'])
      expect(p({ ...entry, parent: undefined })).toEqual(['public.x: inherited needs a parent'])
      expect(p({ class: 'system', tenantColumn: 'none', parentKey: 'k' })).toEqual(['public.x: parentKey and noForeignKey are only for inherited tables'])
    })
  })

  it('flags a derivation trigger that is disabled, in any migration', () => {
    const t = base()
    applySql(t, 'ALTER TABLE public.parent_t DISABLE TRIGGER zz_tenancy_derive_tenant_id;', '20261001000000_x.sql')
    expect(checkTenancy(t, reg()).join('\n')).toMatch(/parent_t: zz_tenancy_derive_tenant_id is disabled/)
    applySql(t, 'ALTER TABLE public.parent_t ENABLE TRIGGER zz_tenancy_derive_tenant_id;', '20261002000000_x.sql')
    expect(checkTenancy(t, reg())).toEqual([])
    applySql(t, 'ALTER TABLE public.parent_t DISABLE TRIGGER ALL;', '20261003000000_x.sql')
    expect(checkTenancy(t, reg()).join('\n')).toMatch(/is disabled/)
  })

  it('follows renames and drops', () => {
    const t = base()
    applySql(t, 'CREATE TABLE public.a_t (id uuid); ALTER TABLE public.a_t RENAME TO b_t; CREATE TABLE public.c_t (id uuid); DROP TABLE IF EXISTS public.c_t;', 'x.sql')
    expect(t.has('public.a_t')).toBe(false)
    expect(t.has('public.b_t')).toBe(true)
    expect(t.has('public.c_t')).toBe(false)
  })
})

describe('tenancy lint fails closed on statements it cannot follow (strict, S3 and later)', () => {
  const FILE = '20261201000000_x.sql'
  const strictIssues = (sql: string, source = FILE) => {
    const t = new Map<string, Table>()
    applySql(t, 'CREATE TABLE public.members (id uuid, email text, date_of_birth date); ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;', 'supabase/baseline.sql')
    applySql(t, `CREATE TABLE public.registrations (id uuid, event_slug text, tenant_id uuid);
      CREATE TRIGGER zz_tenancy_derive_tenant_id BEFORE INSERT ON public.registrations
        FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');`, 'supabase/baseline.sql')
    const issues: Issue[] = []
    applySql(t, sql, source, { strict: true, issues })
    return issues
  }
  const kinds = (sql: string, source?: string) => strictIssues(sql, source).map((i) => i.kind)

  // The reviewer's probe, statement by statement: each passed the lint before.
  it.each([
    ['CREATE TABLE … AS SELECT', 'CREATE TABLE public.probe_ctas AS SELECT id, email, date_of_birth FROM public.members;', 'create-table-form'],
    ['CREATE TABLE … (cols) AS SELECT', 'CREATE TABLE public.probe_ctas2 (a, b) AS SELECT id, email FROM public.members;', 'create-table-form'],
    ['PARTITION OF', 'CREATE TABLE public.probe_part PARTITION OF public.registrations DEFAULT;', 'create-table-form'],
    ['INHERITS', 'CREATE TABLE public.probe_inh (x int) INHERITS (public.registrations);', 'create-table-form'],
    ['dynamic CREATE TABLE in a DO block', "DO $$ BEGIN EXECUTE 'CREATE TABLE public.probe_dyn (id int, event_slug text)'; END $$;", 'ddl-in-plpgsql'],
    ['dynamic DISABLE RLS in a DO block', "DO $$ BEGIN EXECUTE 'ALTER TABLE public.members DISABLE ROW LEVEL SECURITY'; END $$;", 'ddl-in-plpgsql'],
    ['static DDL in a DO block', 'DO $$ BEGIN ALTER TABLE public.members DISABLE ROW LEVEL SECURITY; END $$;', 'ddl-in-plpgsql'],
    ['DDL in a function body', "CREATE OR REPLACE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $f$ BEGIN EXECUTE format('CREATE TABLE public.%I (id int)', 'x'); END $f$;", 'ddl-in-plpgsql'],
    ['DISABLE TRIGGER never re-enabled', 'ALTER TABLE public.registrations DISABLE TRIGGER zz_tenancy_derive_tenant_id;', 'trigger-left-disabled'],
    ['DISABLE TRIGGER ALL never re-enabled', 'ALTER TABLE public.registrations DISABLE TRIGGER ALL;', 'trigger-left-disabled'],
    ['SELECT … INTO', 'SELECT id, email INTO public.probe_into FROM public.members;', 'select-into'],
    ['session_replication_role', "SET session_replication_role = 'replica';", 'session-replication-role'],
    ['materialized view', 'CREATE MATERIALIZED VIEW public.mv AS SELECT * FROM public.members;', 'materialized-view'],
    ['ALTER TRIGGER', 'ALTER TRIGGER zz_tenancy_derive_tenant_id ON public.registrations RENAME TO off;', 'alter-trigger'],
    ['SET SCHEMA', 'ALTER TABLE private.stash SET SCHEMA public;', 'alter-table-form'],
    ['dropping a tenant_id index', 'DROP INDEX IF EXISTS public.registrations_tenant_id_idx;', 'drop-tenant-index'],
  ])('%s', (_label, sql, kind) => {
    expect(kinds(sql)).toContain(kind)
    const t = new Map<string, Table>()
    const issues: Issue[] = []
    applySql(t, sql, FILE, { strict: true, issues })
    expect(checkTenancy(t, {}, issues).join('\n')).toMatch(/fails closed/)
  })

  it('accepts the shapes it does understand', () => {
    expect(kinds(`CREATE TABLE IF NOT EXISTS public.ok_t (id uuid PRIMARY KEY, tenant_id uuid) PARTITION BY HASH (id);
      CREATE TEMP TABLE scratch AS SELECT 1;
      CREATE TABLE public.like_t (LIKE public.members);
      INSERT INTO public.ok_t (id) SELECT id FROM public.members;
      WITH x AS (SELECT 1) INSERT INTO public.ok_t (id) SELECT gen_random_uuid() FROM x;
      CREATE INDEX ok_t_tenant_id_idx ON public.ok_t (tenant_id);
      DROP INDEX IF EXISTS public.ok_t_other_idx;
      DO $$ BEGIN CREATE POLICY p ON public.ok_t FOR ALL TO service_role USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      CREATE OR REPLACE FUNCTION public.g() RETURNS int LANGUAGE sql AS $g$ SELECT 1 $g$;
      ALTER TABLE public.registrations DISABLE TRIGGER zz_tenancy_derive_tenant_id;
      UPDATE public.registrations SET event_slug = event_slug;
      ALTER TABLE public.registrations ENABLE TRIGGER zz_tenancy_derive_tenant_id;
      ALTER TABLE public.registrations DISABLE TRIGGER ALL;
      ALTER TABLE public.registrations ENABLE TRIGGER ALL;`)).toEqual([])
  })

  it('is not strict for migrations before S3 unless asked', () => {
    const t = new Map<string, Table>()
    const issues: Issue[] = []
    applySql(t, 'CREATE TABLE public.old_ctas AS SELECT 1;', '20261001000000_x.sql', { issues })
    expect(issues).toEqual([])
  })

  it('an allowlist entry covers only its own file and kind', () => {
    const backfill = 'DO $$ BEGIN EXECUTE format(\'ALTER TABLE public.%I DISABLE TRIGGER %I\', \'a\', \'b\'); END $$;'
    const allowed = strictIssues(backfill, '20261104140000_tenant_id_backfill.sql')
    expect(checkTenancy(new Map(), {}, allowed)).toEqual([])
    expect(checkTenancy(new Map(), {}, strictIssues(backfill, FILE)).join('\n')).toMatch(/ddl-in-plpgsql/)
    const otherKind = strictIssues('CREATE TABLE public.c AS SELECT 1;', '20261104140000_tenant_id_backfill.sql')
    expect(checkTenancy(new Map(), {}, otherKind).join('\n')).toMatch(/create-table-form/)
    expect(Object.keys(UNPARSED_ALLOWLIST)).toEqual(['20261104140000_tenant_id_backfill.sql'])
  })
})
