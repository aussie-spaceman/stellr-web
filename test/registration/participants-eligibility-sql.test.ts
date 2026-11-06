// The participants trigger (S5 A3) repeats the numbers lib/registration/eligibility.ts
// decides with, because SQL cannot import them. This reads the constants and the
// SQL, so changing one side alone fails here. The database behaviour itself is
// proven by supabase/tests/database/participant_eligibility.test.sql, in CI's db job.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_AGE } from '@/lib/registration-eligibility'
import { TENANT_MIN_AGE_TODAY } from '@/lib/registration/eligibility'
import { STELLR_TENANT_ID, TENANT_MIN_PARTICIPANT_AGE } from '@/lib/tenancy/constants'

const MIGRATIONS = join(process.cwd(), 'supabase/migrations')
const migrationName = readdirSync(MIGRATIONS).filter((f) => f.endsWith('_participants_eligibility.sql'))
const migration = readFileSync(join(MIGRATIONS, migrationName[0] ?? ''), 'utf8')
const pgtap = readFileSync(join(process.cwd(), 'supabase/tests/database/participant_eligibility.test.sql'), 'utf8')

/** The migration's declaration, spaced exactly as pgTAP's prosrc match expects. */
function declared(name: string): string {
  const m = new RegExp(`^\\s*${name} constant int := (\\d+);`, 'm').exec(migration)
  return m?.[1] ?? ''
}

describe('participants eligibility SQL matches the TypeScript rule', () => {
  it('there is exactly one participants_eligibility migration', () => {
    expect(migrationName).toHaveLength(1)
  })

  it('the SQL floor equals TENANT_MIN_PARTICIPANT_AGE', () => {
    expect(declared('platform_min_age')).toBe(String(TENANT_MIN_PARTICIPANT_AGE))
  })

  it('the SQL under-13-today line equals TENANT_MIN_AGE_TODAY', () => {
    expect(declared('min_age_today')).toBe(String(TENANT_MIN_AGE_TODAY))
  })

  it('the SQL oldest age equals MAX_AGE', () => {
    expect(declared('max_age')).toBe(String(MAX_AGE))
  })

  it('every Stellr id in the migration is STELLR_TENANT_ID', () => {
    const ids = migration.match(/stellr\s+constant\s+uuid\s*:=\s*'([^']+)'/g) ?? []
    expect(ids.length).toBeGreaterThanOrEqual(2)
    for (const id of ids) expect(id).toContain(STELLR_TENANT_ID)
  })

  it('pgTAP asserts each literal against the function the database actually holds', () => {
    const live = /prosrc LIKE '%(\w+) constant int := (\d+);%'/g
    const seen = Object.fromEntries([...pgtap.matchAll(live)].map((m) => [m[1], m[2]]))
    expect(seen).toEqual({
      platform_min_age: String(TENANT_MIN_PARTICIPANT_AGE),
      min_age_today: String(TENANT_MIN_AGE_TODAY),
      max_age: String(MAX_AGE),
    })
  })

  it('the participants trigger sorts after the triggers it depends on', () => {
    // Postgres fires same-event triggers in name order, compared bytewise.
    expect(migration).toContain('CREATE TRIGGER zzz_participants_assert_eligible')
    expect('zzz_participants_assert_eligible' > 'zz_tenancy_derive_tenant_id').toBe(true)
    expect('zzz_participants_assert_eligible' > 'participants_inherit_membership_id_trg').toBe(true)
    expect('zzz_registrations_assert_eligible' > 'zz_tenancy_derive_tenant_id').toBe(true)
  })

  it('a refusal message carries the reason and no value from the row', () => {
    const raises = migration.match(/RAISE EXCEPTION .*$/gm) ?? []
    expect(raises).toHaveLength(4)
    for (const line of raises) {
      expect(line).toBe(`RAISE EXCEPTION 'participant eligibility: %', refusal USING ERRCODE = '23514';`)
    }
  })

  it('applying it fails fast on a held lock', () => {
    const firstStatement = migration.replace(/^\s*--.*$/gm, '').trim().split(';')[0]
    expect(firstStatement).toBe(`SET LOCAL lock_timeout = '5s'`)
  })

  it('the events re-check fires on, and only on, each column that changes the answer', () => {
    const trigger = /CREATE TRIGGER zz_events_assert_participants_eligible([\s\S]*?)EXECUTE FUNCTION/.exec(migration)?.[1] ?? ''
    const named = /UPDATE OF ([\w, ]+) ON public\.events/.exec(trigger)?.[1]?.split(', ') ?? []
    const compared = [...trigger.matchAll(/OLD\.(\w+) IS DISTINCT FROM NEW\.(\w+)/g)].map((m) => {
      expect(m[1]).toBe(m[2])
      return m[1]
    })
    expect([...named].sort()).toEqual(['min_participant_age', 'slug', 'starts_at', 'tenant_id', 'time_zone'])
    expect([...compared].sort()).toEqual([...named].sort())
  })

  it('the pgTAP plan matches the number of assertions in the file', () => {
    const planned = Number(/SELECT plan\((\d+)\)/.exec(pgtap)?.[1])
    const assertions = pgtap.match(/^SELECT (?:ok|is|throws_ok|lives_ok)\(/gm) ?? []
    expect(assertions).toHaveLength(planned)
  })
})
