import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { STELLR_ONLY_CHECKS, TABLE_REGISTRY } from '@/lib/tenancy/registry'
import { ROUTE_MANIFEST } from '@/lib/security/route-manifest'
import { tenantSurfaceDecision } from '@/lib/tenancy/tenant-surface'

// S5 B9. The CI `db` job runs the behaviour (supabase/tests/database/
// community_stellr_only.test.sql). This pins the shape of the migration, which CI's
// database cannot show: a lock timeout, and no constraint added without its check.

const MIGRATIONS = 'supabase/migrations'
const file = readdirSync(MIGRATIONS).filter((f) => f.endsWith('_community_stellr_only_check.sql'))
const sql = readFileSync(`${MIGRATIONS}/${file[0]}`, 'utf8')
const statements = sql.replace(/^--.*$/gm, '').replace(/\s+/g, ' ')
const pgtap = readFileSync('supabase/tests/database/community_stellr_only.test.sql', 'utf8')

describe('the community_stellr_only_check migration', () => {
  it('exists once', () => {
    expect(file).toHaveLength(1)
  })

  it('covers the four derived community tables and no others', () => {
    expect(STELLR_ONLY_CHECKS.map((c) => c.table)).toEqual([
      'public.community_resources',
      'public.community_spaces',
      'public.mentoring_cohorts',
      'public.training_modules',
    ])
    const added = [...statements.matchAll(/ALTER TABLE (\S+) ADD CONSTRAINT (\S+) /g)].map(([, table, constraint]) => ({ table, constraint }))
    expect(added.sort((a, b) => a.table.localeCompare(b.table))).toEqual([...STELLR_ONLY_CHECKS])
  })

  it.each(STELLR_ONLY_CHECKS)('$constraint is added NOT VALID, allows NULL or Stellr, and is then validated', ({ table, constraint }) => {
    expect(statements).toContain(
      `ALTER TABLE ${table} ADD CONSTRAINT ${constraint} CHECK (tenant_id IS NULL OR tenant_id = '${STELLR_TENANT_ID}'::uuid) NOT VALID;`,
    )
    expect(statements).toContain(`ALTER TABLE ${table} VALIDATE CONSTRAINT ${constraint};`)
    expect(statements.indexOf(`ADD CONSTRAINT ${constraint}`)).toBeLessThan(statements.indexOf(`VALIDATE CONSTRAINT ${constraint}`))
  })

  it.each(STELLR_ONLY_CHECKS)('$table takes its tenant from an event, so the check is what bounds it', ({ table }) => {
    expect(TABLE_REGISTRY[table].tenantColumn).toBe('derived')
  })

  it('bounds its wait for a lock before it takes one', () => {
    const timeout = statements.indexOf("SET LOCAL lock_timeout = '5s';")
    expect(timeout).toBeGreaterThanOrEqual(0)
    expect(timeout).toBeLessThan(statements.indexOf('ALTER TABLE'))
  })

  it('has a database test for every table', () => {
    for (const { table, constraint } of STELLR_ONLY_CHECKS) {
      expect(pgtap).toContain(`'${table}', '${constraint}'`)
      expect(pgtap).toContain(`INSERT INTO ${table} `)
    }
  })
})

describe('the two community writes named by id', () => {
  // The IDOR snapshot accepts these as Stellr-only. What makes that true: a workshop is
  // a mentoring_cohorts row and a lesson hangs off training_modules, which now hold only
  // Stellr's rows, and neither route is served on a tenant host.
  it.each(['app/api/community/coaching/request/route.ts', 'app/api/community/training/[itemId]/flag/route.ts'])(
    '%s is never served on a tenant host',
    (route) => {
      expect(ROUTE_MANIFEST).toHaveProperty([route])
      expect(tenantSurfaceDecision(route)).toBe('deny')
    },
  )

  // A lesson needs its module for the check to reach it. The flag route's behaviour is in
  // app/api/community/training/[itemId]/flag/route.test.ts, and requestSession's in
  // lib/coaching-request-session.test.ts.
  it('every lesson hangs off a module', () => {
    const baseline = readFileSync('supabase/baseline.sql', 'utf8')
    const table = baseline.slice(baseline.indexOf('CREATE TABLE public.training_items ('))
    expect(table.slice(0, table.indexOf(');'))).toMatch(/module_id uuid NOT NULL/)
  })
})

describe('the sync-event-spaces script', () => {
  // It runs main() on import, so it cannot be called from here. The functions it leans on
  // are tested in lib/event-space-sync.test.ts; this pins that it leans on them.
  const script = readFileSync('scripts/sync-event-spaces.ts', 'utf8')

  it('does not count a skipped event as a failure', () => {
    expect(script).toContain('if (eventSpaceSyncFailed(r)) failed++')
    expect(script).not.toContain('if (!r.spaceId) failed++')
  })

  it('reports another tenant\'s event in the dry run before looking for its Space', () => {
    const skip = script.indexOf('otherTenant.has(ev._id)')
    expect(skip).toBeGreaterThanOrEqual(0)
    expect(skip).toBeLessThan(script.indexOf('const found ='))
  })
})
