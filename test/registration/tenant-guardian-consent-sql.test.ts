import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { TENANT_MIN_AGE_WITHOUT_GUARDIAN_CONSENT } from '@/lib/registration/eligibility'
import { TENANT_GUARDIAN_CONSENT_WINDOW_DAYS } from '@/lib/registration/tenant-guardian-consent'

// S5 wave 6: the consent trigger in SQL decides who is consent-pending with the same
// numbers the register route uses. pgTAP (supabase/tests/database/
// tenant_guardian_consent.test.sql) runs the trigger in CI's db job; this keeps its
// literals equal to their TypeScript constants, as participants-eligibility-sql
// does for A3.

const SQL = readFileSync('supabase/migrations/20261110164339_tenant_guardian_consent.sql', 'utf8')

function opener(): string {
  const start = SQL.indexOf('CREATE OR REPLACE FUNCTION public.participants_open_tenant_guardian_consent()')
  const end = SQL.indexOf('END $$;', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return SQL.slice(start, end)
}

const literal = (body: string, name: string) => body.match(new RegExp(`${name} constant (?:int|uuid) := '?([^';]+)'?;`))?.[1]

describe('tenant guardian consent migration', () => {
  it('the trigger opens consent for exactly the minors the register route treats as minors', () => {
    const body = opener()
    expect(Number(literal(body, 'adult_age'))).toBe(TENANT_MIN_AGE_WITHOUT_GUARDIAN_CONSENT)
    expect(Number(literal(body, 'window_days'))).toBe(TENANT_GUARDIAN_CONSENT_WINDOW_DAYS)
    expect(literal(body, 'stellr')).toBe(STELLR_TENANT_ID)
  })

  it('runs on every participant write that can make someone a tenant-event minor, in the same statement', () => {
    expect(SQL).toMatch(
      /CREATE TRIGGER zzz_participants_open_tenant_guardian_consent\s+AFTER INSERT OR UPDATE OF date_of_birth, registration_id ON public\.participants\s+FOR EACH ROW/,
    )
    expect(SQL).toMatch(/REVOKE EXECUTE ON FUNCTION public\.participants_open_tenant_guardian_consent\(\) FROM PUBLIC, anon, authenticated;/)
  })

  it('an UPDATE that leaves the participant 18 or over removes a consent still pending, and only that', () => {
    const body = opener()
    const adult = body.slice(body.indexOf(') >= adult_age THEN'), body.indexOf('INSERT INTO public.tenant_guardian_consents'))
    expect(adult).toMatch(
      /IF TG_OP = 'UPDATE' THEN\s+DELETE FROM public\.tenant_guardian_consents c\s+WHERE c\.participant_id = NEW\.id AND c\.status = 'pending';\s+END IF;\s+RETURN NULL;/,
    )
  })

  it('does not claim a NOT VALID + VALIDATE pair in one transaction avoids the exclusive lock', () => {
    // Both would run in this migration's one transaction, so the scan holds the
    // DROP's ACCESS EXCLUSIVE lock either way. The header must say so.
    expect(SQL).not.toMatch(/VALIDATE CONSTRAINT/)
    expect(SQL).not.toMatch(/\bNOT VALID\b/)
    expect(SQL).toMatch(/ACCESS EXCLUSIVE lock/)
  })

  it('narrows service_role to the grant it names (no TRUNCATE)', () => {
    expect(SQL).toMatch(/REVOKE ALL ON public\.tenant_guardian_consents FROM PUBLIC, anon, authenticated, service_role;\s*GRANT SELECT, INSERT, UPDATE, DELETE ON public\.tenant_guardian_consents TO service_role;/)
  })
})
