// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  scanMigrations,
  readMigrationFiles,
  isGrandfathered,
  MIGRATIONS_DIR,
  GRANDFATHERED_PREEXISTING,
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
    REVOKE EXECUTE ON FUNCTION public.mint_credit(uuid) FROM anon, authenticated;
  `,
  schemaUsageRevoked: `
    CREATE OR REPLACE FUNCTION entitlements.mint_credit(p_member uuid)
    RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
    REVOKE USAGE ON SCHEMA entitlements FROM anon, authenticated;
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

  it('accepts a REVOKE EXECUTE ... FROM anon, authenticated', () => {
    expect(flags(sql.revoked)).toBe(false)
  })

  it('accepts a schema-level REVOKE USAGE ... FROM anon, authenticated', () => {
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
        sql: 'REVOKE EXECUTE ON FUNCTION public.mint_credit(uuid) FROM anon, authenticated;',
      },
    ]).offenders
    expect(offenders).toEqual([])
  })

  it('grandfathers the frozen history (sequential ≤ 148 and the named pre-existing files)', () => {
    expect(isGrandfathered('118_security_advisor_warn_hardening.sql')).toBe(true)
    expect(isGrandfathered('20261002180802_esign_native_engine.sql')).toBe(true)
    // ...but NOT a brand-new timestamped migration.
    expect(isGrandfathered(NEW)).toBe(false)
  })

  it('every grandfathered-pre-existing entry still exists (no stale exemption hiding a gap)', () => {
    const present = new Set(readMigrationFiles(MIGRATIONS_DIR).map((f) => f.name))
    for (const name of GRANDFATHERED_PREEXISTING) {
      expect(present.has(name), `${name} is grandfathered but no longer exists`).toBe(true)
    }
  })
})
