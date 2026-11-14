// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  scanMigrations,
  readMigrationFiles,
  isGrandfathered,
  MIGRATIONS_DIR,
  GRANDFATHERED_PREEXISTING,
  FROZEN_RLS_HELPERS,
  scanTableRevokes,
  isTableRuleGrandfathered,
  TABLE_REVOKE_CUTOFF,
} from '../scripts/check-migration-security.mjs'

// deep review DB-N3: a SECURITY DEFINER function bypasses RLS and is EXECUTE-able
// by anon + authenticated by default, so one that forgets the explicit revoke is
// an unauthenticated RPC on a public repo. This is the recurring root cause of
// C-6 (entitlements) and the two-step esign fix. These tests pin the lint that
// catches the next one, and — crucially — pin the escape hatch the RLS helpers
// (can_read_space / can_read_chat_channel) and the upcoming can_read_chat_channel
// safeguarding fix (DB-N1) depend on.

// A NEW migration (timestamp beyond the grandfathered tree), so these fixtures
// exercise the enforced path, not the frozen history.
const NEW = '20991231000000_fixture.sql'

const sql = {
  bare: `
    CREATE OR REPLACE FUNCTION public.mint_credit(p_member uuid)
    RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
  `,
  fromPublicOnly: `
    -- The exact shape of the FIRST esign migration: FROM PUBLIC leaves the
    -- direct anon/authenticated grants intact, so it must still be flagged.
    CREATE OR REPLACE FUNCTION public.mint_credit(p_member uuid)
    RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
    REVOKE EXECUTE ON FUNCTION public.mint_credit(uuid) FROM PUBLIC;
  `,
  revoked: `
    CREATE OR REPLACE FUNCTION public.mint_credit(p_member uuid)
    RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
    REVOKE EXECUTE ON FUNCTION public.mint_credit(uuid) FROM PUBLIC, anon, authenticated;
  `,
  // FROM anon, authenticated WITHOUT PUBLIC leaves the default PUBLIC grant, which
  // has_function_privilege('anon', …) resolves through — the bump_email_quota bug
  // (10 Oct 2026) the first cut of this lint wrongly passed. Must be flagged.
  anonAuthOnly: `
    CREATE OR REPLACE FUNCTION public.mint_credit(p_member uuid)
    RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
    REVOKE EXECUTE ON FUNCTION public.mint_credit(uuid) FROM anon, authenticated;
  `,
  schemaUsageRevoked: `
    CREATE OR REPLACE FUNCTION entitlements.mint_credit(p_member uuid)
    RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
    REVOKE USAGE ON SCHEMA entitlements FROM PUBLIC, anon, authenticated;
  `,
  // The can_read_chat_channel / can_read_space shape: SECURITY DEFINER that MUST
  // keep authenticated EXECUTE, justified by the allowlist comment.
  rlsHelperAnnotated: `
    -- rls-helper: keep authenticated EXECUTE (RLS policy calls this).
    CREATE OR REPLACE FUNCTION public.can_read_thing(_id uuid, _sub text)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT true $$;
    REVOKE EXECUTE ON FUNCTION public.can_read_thing(uuid, text) FROM anon, PUBLIC;
  `,
  rlsHelperUnannotated: `
    CREATE OR REPLACE FUNCTION public.can_read_thing(_id uuid, _sub text)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT true $$;
    REVOKE EXECUTE ON FUNCTION public.can_read_thing(uuid, text) FROM anon, PUBLIC;
  `,
}

const flags = (text: string) =>
  scanMigrations([{ name: NEW, sql: text }]).offenders.length > 0

describe('check-migration-security (DB-N3)', () => {
  it('passes on the current repo — no SECURITY DEFINER function is anon/authenticated-reachable', () => {
    const { offenders, sdFunctions } = scanMigrations(readMigrationFiles(MIGRATIONS_DIR))
    // Sanity: the sweep actually found the real functions, or it is vacuously green.
    expect(sdFunctions.length).toBeGreaterThan(20)
    expect(offenders).toEqual([])
  })

  it('flags a new SECURITY DEFINER function with no revoke and no annotation', () => {
    expect(flags(sql.bare)).toBe(true)
  })

  it('still flags it when the revoke is FROM PUBLIC only (the esign two-step bug)', () => {
    // FROM PUBLIC does not remove the direct anon/authenticated grants.
    expect(flags(sql.fromPublicOnly)).toBe(true)
  })

  it('accepts a REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated', () => {
    expect(flags(sql.revoked)).toBe(false)
  })

  it('flags a revoke naming anon + authenticated but NOT public (the bump_email_quota bug)', () => {
    // The default PUBLIC grant remains, so anon still reaches it through PUBLIC.
    expect(flags(sql.anonAuthOnly)).toBe(true)
  })

  it('accepts a schema-level REVOKE USAGE ... FROM PUBLIC, anon, authenticated', () => {
    expect(flags(sql.schemaUsageRevoked)).toBe(false)
  })

  it('accepts an RLS helper that keeps authenticated EXECUTE when annotated', () => {
    // can_read_space / can_read_chat_channel (and the DB-N1 fix) depend on this.
    expect(flags(sql.rlsHelperAnnotated)).toBe(false)
  })

  it('flags the SAME RLS helper when the allowlist annotation is removed', () => {
    // Proves the annotation is load-bearing — an anon,PUBLIC revoke alone (which
    // keeps authenticated) is NOT silently accepted.
    expect(flags(sql.rlsHelperUnannotated)).toBe(true)
  })

  it('accepts a revoke that lands in a later (atomic follow-up) migration', () => {
    const offenders = scanMigrations([
      { name: NEW, sql: sql.bare },
      {
        name: '20991231000001_seal.sql',
        sql: 'REVOKE EXECUTE ON FUNCTION public.mint_credit(uuid) FROM PUBLIC, anon, authenticated;',
      },
    ]).offenders
    expect(offenders).toEqual([])
  })

  it('grandfathers only the sequential frozen history (≤ 148), no timestamped file', () => {
    expect(isGrandfathered('118_security_advisor_warn_hardening.sql')).toBe(true)
    // DB-N3: these used to be grandfathered; 20261102220634 sealed them instead.
    expect(GRANDFATHERED_PREEXISTING).toEqual([])
    expect(isGrandfathered('20261002180802_esign_native_engine.sql')).toBe(false)
    expect(isGrandfathered('20261002235036_post_event_survey.sql')).toBe(false)
    expect(isGrandfathered(NEW)).toBe(false)
  })

  it('flags the DB-N3 functions when the sealing migration is absent', () => {
    // Proves the repo is green because of the seal, not because nothing is checked.
    const corpus = readMigrationFiles(MIGRATIONS_DIR).filter(
      (f) => f.name !== '20261102220634_seal_definer_functions_db_n3.sql',
    )
    const flagged = scanMigrations(corpus).offenders.map((o) => o.fn)
    for (const fn of [
      'public.survey_purge_person',
      'public.esign_purge_audit',
      'public.esign_append_audit',
      'public.survey_claim_email',
      'public.survey_current_member_id',
    ]) {
      expect(flagged, fn).toContain(fn)
    }
  })

  it('accepts a frozen RLS helper only once PUBLIC and anon are revoked', () => {
    const frozen = {
      name: '20261002235036_post_event_survey.sql',
      sql: `CREATE OR REPLACE FUNCTION public.survey_current_member_id()
        RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT NULL::uuid $$;`,
    }
    expect(Object.keys(FROZEN_RLS_HELPERS)).toContain('public.survey_current_member_id')
    // Still anon-reachable: flagged.
    expect(scanMigrations([frozen]).offenders).toHaveLength(1)
    // PUBLIC only (anon keeps its direct grant): flagged.
    expect(
      scanMigrations([
        frozen,
        { name: NEW, sql: 'REVOKE EXECUTE ON FUNCTION public.survey_current_member_id() FROM PUBLIC;' },
      ]).offenders,
    ).toHaveLength(1)
    // PUBLIC and anon gone, authenticated kept: accepted.
    expect(
      scanMigrations([
        frozen,
        { name: NEW, sql: 'REVOKE EXECUTE ON FUNCTION public.survey_current_member_id() FROM PUBLIC, anon;' },
      ]).offenders,
    ).toEqual([])
  })
})

// S2-revoke-lint (THREAT-MODEL TB5 E, R4a): baseline.sql's default privileges
// GRANT ALL on every new public table to anon and authenticated, so a new table
// must revoke both in the same migration, or a permissive policy exposes it to
// the public anon key.
describe('check-migration-security: new public tables revoke anon + authenticated (S2-revoke-lint)', () => {
  const tableOffenders = (text: string, name = NEW) => scanTableRevokes([{ name, sql: text }]).offenders

  it('passes on the current repo, and actually sees the tables', () => {
    const { offenders, tables } = scanTableRevokes(readMigrationFiles(MIGRATIONS_DIR))
    expect(tables.length).toBeGreaterThan(100)
    expect(offenders).toEqual([])
  })

  it('flags a new CREATE TABLE with no REVOKE, naming the file and the table', () => {
    const offenders = tableOffenders('CREATE TABLE public.widgets (id uuid PRIMARY KEY);')
    expect(offenders).toEqual([{ file: NEW, table: 'public.widgets', missing: ['anon', 'authenticated'] }])
  })

  it('flags an unqualified CREATE TABLE IF NOT EXISTS with no REVOKE', () => {
    expect(tableOffenders('CREATE TABLE IF NOT EXISTS widgets (id uuid);')).toHaveLength(1)
  })

  it('accepts REVOKE ALL ... FROM PUBLIC, anon, authenticated in the same file', () => {
    expect(
      tableOffenders(`
        CREATE TABLE IF NOT EXISTS public.widgets (id uuid PRIMARY KEY);
        ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;
        REVOKE ALL ON public.widgets FROM PUBLIC, anon, authenticated;
        GRANT SELECT ON public.widgets TO service_role;
      `),
    ).toEqual([])
  })

  it('accepts FROM anon, authenticated without PUBLIC, and the TABLE keyword / PRIVILEGES form', () => {
    expect(
      tableOffenders(`
        CREATE TABLE public.widgets (id uuid);
        REVOKE ALL PRIVILEGES ON TABLE widgets FROM anon, authenticated;
      `),
    ).toEqual([])
  })

  it('accepts the two roles revoked in separate statements of the same file', () => {
    expect(
      tableOffenders(`
        CREATE TABLE public.widgets (id uuid);
        REVOKE ALL ON public.widgets FROM anon;
        REVOKE ALL ON public.widgets FROM authenticated;
      `),
    ).toEqual([])
  })

  it('flags a revoke that misses authenticated, or names only PUBLIC', () => {
    expect(
      tableOffenders('CREATE TABLE public.widgets (id uuid);\nREVOKE ALL ON public.widgets FROM PUBLIC, anon;'),
    ).toEqual([{ file: NEW, table: 'public.widgets', missing: ['authenticated'] }])
    expect(tableOffenders('CREATE TABLE public.widgets (id uuid);\nREVOKE ALL ON public.widgets FROM PUBLIC;')).toHaveLength(1)
  })

  it('flags a revoke of a narrower privilege (SELECT) instead of ALL', () => {
    expect(
      tableOffenders('CREATE TABLE public.widgets (id uuid);\nREVOKE SELECT ON public.widgets FROM anon, authenticated;'),
    ).toHaveLength(1)
  })

  it('flags REVOKE GRANT OPTION FOR ALL, which leaves every privilege in place', () => {
    const offenders = tableOffenders(
      'CREATE TABLE public.widgets (id uuid);\nREVOKE GRANT OPTION FOR ALL ON public.widgets FROM anon, authenticated;',
    )
    expect(offenders).toHaveLength(1)
    expect(offenders[0].missing).toEqual(['anon', 'authenticated'])
    expect(
      tableOffenders(
        'CREATE TABLE public.widgets (id uuid);\nREVOKE GRANT OPTION FOR ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;',
      ),
    ).toHaveLength(1)
  })

  it('flags a revoke of a DIFFERENT table', () => {
    expect(
      tableOffenders('CREATE TABLE public.widgets (id uuid);\nREVOKE ALL ON public.gadgets FROM anon, authenticated;'),
    ).toHaveLength(1)
  })

  it('handles quoted identifiers, quoted or unquoted on either side, and multi-table revokes', () => {
    expect(
      tableOffenders(`
        CREATE TABLE IF NOT EXISTS "public"."widgets" (id uuid);
        CREATE TABLE "Gadgets" (id uuid);
        REVOKE ALL ON public.widgets, public."Gadgets" FROM "anon", "authenticated";
      `),
    ).toEqual([])
    // "Gadgets" is case-sensitive: revoking unquoted gadgets (= gadgets) misses it.
    expect(
      tableOffenders(`
        CREATE TABLE "Gadgets" (id uuid);
        REVOKE ALL ON gadgets FROM anon, authenticated;
      `),
    ).toEqual([{ file: NEW, table: 'public.Gadgets', missing: ['anon', 'authenticated'] }])
  })

  it('accepts REVOKE ALL ON ALL TABLES IN SCHEMA public only when it comes after the CREATE TABLE', () => {
    expect(
      tableOffenders(
        'CREATE TABLE public.widgets (id uuid);\nREVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;',
      ),
    ).toEqual([])
    expect(
      tableOffenders(
        'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;\nCREATE TABLE public.widgets (id uuid);',
      ),
    ).toHaveLength(1)
  })

  it('sees a CREATE TABLE and its REVOKE inside a DO block', () => {
    const body = (revoke: string) => `
      DO $$
      BEGIN
        CREATE TABLE IF NOT EXISTS public.widgets (id uuid);
        ${revoke}
      END
      $$;`
    expect(tableOffenders(body(''))).toHaveLength(1)
    expect(tableOffenders(body('REVOKE ALL ON public.widgets FROM anon, authenticated;'))).toEqual([])
  })

  it('ignores tables outside schema public, temporary tables, and CREATE TABLE in comments or strings', () => {
    expect(tableOffenders('CREATE TABLE entitlements.ledger (id uuid);')).toEqual([])
    expect(tableOffenders('CREATE TEMP TABLE scratch (id uuid);')).toEqual([])
    expect(
      tableOffenders(`
        -- CREATE TABLE public.widgets (id uuid);
        /* CREATE TABLE public.gadgets (id uuid); */
        COMMENT ON SCHEMA public IS 'CREATE TABLE public.sprockets';
      `),
    ).toEqual([])
  })

  it('does not accept a REVOKE in a later migration: the table is open between deploys', () => {
    const { offenders } = scanTableRevokes([
      { name: NEW, sql: 'CREATE TABLE public.widgets (id uuid);' },
      { name: '20991231000001_seal.sql', sql: 'REVOKE ALL ON public.widgets FROM anon, authenticated;' },
    ])
    expect(offenders).toHaveLength(1)
  })

  it('grandfathers every migration at or before the cutoff, and nothing after it', () => {
    const bare = 'CREATE TABLE public.widgets (id uuid);'
    expect(TABLE_REVOKE_CUTOFF).toBe('20261114090000')
    expect(isTableRuleGrandfathered('042_old_sequential.sql')).toBe(true)
    expect(isTableRuleGrandfathered('20260928180000_cron_runs.sql')).toBe(true)
    expect(isTableRuleGrandfathered(`${TABLE_REVOKE_CUTOFF}_record_access_log.sql`)).toBe(true)
    expect(isTableRuleGrandfathered('20261114090001_next.sql')).toBe(false)
    expect(tableOffenders(bare, '20260928180000_cron_runs.sql')).toEqual([])
    expect(tableOffenders(bare, '20261114090001_next.sql')).toHaveLength(1)
  })

  it('the cutoff is not later than the newest migration in the repo', () => {
    // Moving the cutoff forward past real files would silently grandfather a
    // new violation; the cutoff must name a migration that exists.
    const names = readMigrationFiles(MIGRATIONS_DIR).map((f) => f.name)
    expect(names.some((n) => n.startsWith(`${TABLE_REVOKE_CUTOFF}_`))).toBe(true)
  })
})
