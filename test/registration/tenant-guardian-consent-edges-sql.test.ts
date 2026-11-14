import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { TENANT_MIN_AGE_WITHOUT_GUARDIAN_CONSENT } from '@/lib/registration/eligibility'
import { CONSENT_STATUSES, HELD_CONSENT_STATUSES, TENANT_GUARDIAN_CONSENT_WINDOW_DAYS } from '@/lib/registration/tenant-guardian-consent'

// The consent edges migration (AMD-CONSENT-EDGES, fixA-notdone-move, T-25) redefines
// both consent triggers. pgTAP (supabase/tests/database/tenant_guardian_consent.test.sql)
// runs them in CI's db job; this keeps the new bodies' literals and statuses equal to
// their TypeScript constants, as tenant-guardian-consent-sql.test.ts does for the first.

const FILE = 'supabase/migrations/20261114072142_tenant_guardian_consent_edges.sql'
const SQL = readFileSync(FILE, 'utf8')

function body(fn: string): string {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}()`)
  const end = SQL.indexOf('END $$;', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return SQL.slice(start, end)
}

const literal = (src: string, name: string) => src.match(new RegExp(`${name} constant (?:int|uuid) := '?([^';]+)'?;`))?.[1]
const quoted = (list: string) => [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])

describe('tenant guardian consent edges migration', () => {
  it('the opener keeps the numbers the register route uses', () => {
    const opener = body('participants_open_tenant_guardian_consent')
    expect(Number(literal(opener, 'adult_age'))).toBe(TENANT_MIN_AGE_WITHOUT_GUARDIAN_CONSENT)
    expect(Number(literal(opener, 'window_days'))).toBe(TENANT_GUARDIAN_CONSENT_WINDOW_DAYS)
    expect(literal(opener, 'stellr')).toBe(STELLR_TENANT_ID)
  })

  it('the status CHECK holds exactly the TypeScript statuses', () => {
    const check = SQL.match(/ADD CONSTRAINT tenant_guardian_consents_status_check\s+CHECK \(status IN \(([^)]*)\)\)/)
    expect(check).not.toBeNull()
    expect(quoted(check![1])).toEqual([...CONSENT_STATUSES])
  })

  it('both triggers hold exactly the statuses the app treats as held', () => {
    const notHeld = CONSENT_STATUSES.filter((s) => !(HELD_CONSENT_STATUSES as readonly string[]).includes(s))
    expect(notHeld).toEqual(['signed', 'settled'])
    for (const fn of ['participants_refuse_unconsented_check_in', 'participants_open_tenant_guardian_consent']) {
      const clauses = [...body(fn).matchAll(/c\.status NOT IN \(([^)]*)\)/g)].map((m) => quoted(m[1]))
      expect(clauses.length, fn).toBeGreaterThan(0)
      for (const c of clauses) expect(c, fn).toEqual(notHeld)
      expect(body(fn), fn).not.toMatch(/c\.status <> 'signed'/)
    }
  })

  it('T-25: a correction to 18 or over settles a pending row, and no longer deletes it', () => {
    const opener = body('participants_open_tenant_guardian_consent')
    const adult = opener.slice(opener.indexOf(') >= adult_age THEN'), opener.indexOf('INSERT INTO public.tenant_guardian_consents'))
    expect(adult).toMatch(
      /IF TG_OP = 'UPDATE' THEN\s+UPDATE public\.tenant_guardian_consents c\s+SET status = 'settled', settled_at = now\(\)\s+WHERE c\.participant_id = NEW\.id AND c\.status = 'pending';\s+END IF;\s+RETURN NULL;/,
    )
    expect(adult).not.toMatch(/DELETE/)
  })

  it('fixA-notdone-move: a move onto Stellr’s event removes only a pending row', () => {
    const opener = body('participants_open_tenant_guardian_consent')
    const stellr = opener.slice(opener.indexOf('IF NOT FOUND OR (ev.is_platform_owner AND ev.tenant_id = stellr) THEN'), opener.indexOf('IF NEW.date_of_birth IS NULL THEN\n    RETURN NULL;'))
    expect(stellr).toMatch(/IF moved THEN\s+DELETE FROM public\.tenant_guardian_consents c\s+WHERE c\.participant_id = NEW\.id AND c\.status = 'pending';\s+END IF;\s+RETURN NULL;/)
  })

  it('a settled row re-opens when the participant is a minor again, with its escalation cleared', () => {
    const opener = body('participants_open_tenant_guardian_consent')
    expect(opener).toMatch(/escalated_at\s+= NULL/)
    expect(opener).toMatch(/WHERE c\.registration_id IS DISTINCT FROM EXCLUDED\.registration_id\s+OR c\.status = 'settled';/)
  })

  it('replaces the trigger functions in place: no trigger is dropped, and EXECUTE stays revoked', () => {
    expect(SQL).not.toMatch(/DROP TRIGGER/)
    for (const fn of ['participants_refuse_unconsented_check_in', 'participants_open_tenant_guardian_consent']) {
      expect(SQL).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\(\\) FROM PUBLIC, anon, authenticated;`))
    }
  })

  it('the removal index leaves escalated rows out, as the sweep’s read does', () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS escalated_at timestamptz;/)
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS tenant_guardian_consents_removal_idx\s+ON public\.tenant_guardian_consents \(next_attempt_at\)\s+WHERE status IN \('declined', 'expired'\) AND escalated_at IS NULL;/)
  })
})
