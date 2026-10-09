// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// readdirSync(dir, { recursive: true }) returns paths relative to `dir`; we
// re-prefix so the matcher and the allow-list key read as repo-root paths.
// (fs.globSync exists on Node 22+ but isn't in this repo's @types/node yet.)
function routeFiles(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((p) => p.replace(/\\/g, '/').endsWith('/route.ts') || p === 'route.ts')
    .map((p) => `${dir}/${p.replace(/\\/g, '/')}`)
}

// deep review TEST-3: proxy.ts guards /admin *pages* but not /api/admin/*, and
// the server reads with service_role (RLS never applies), so a per-route guard is
// the only thing protecting admin data on minors/members. Nothing failed if a new
// admin route forgot its guard, or a new cron route forgot guardCron. This is a
// cheap static sweep that catches that omission — the most dangerous class.
//
// The guard is written many ways across 141 files, so the matcher below lists
// every idiom actually in use. Adding a route with a NEW guard helper means
// adding its name here too — a deliberate, visible step. (fs.globSync is Node 22+;
// CI and Vercel run Node 24.)

// Every admin-guard idiom in the codebase: the shared helpers, the local
// requireAdmin/isAdmin functions, the store/survey/scholarship gates, and the
// inline role check. A file matching ANY of these is considered guarded.
const ADMIN_GUARD =
  /isAdminClaims|currentUserIsAdmin|currentUserHasScope|requireEventAccess|requireScholarshipAdmin|requireSurveyAdmin|canManageStoreCatalog|requireAdmin|isAdmin|adminName|role\s*(!==|===)\s*['"]admin['"]/

// Admin routes that are deliberately NOT gated by an admin session. Each entry
// needs a WHY: a stale entry here is the one way this test can hide a regression.
const ALLOW_UNGUARDED: Record<string, string> = {
  // Sanity → Supabase publish webhook: there is no admin session (Sanity calls
  // it), so it is guarded by a constant-time shared-secret compare instead.
  'app/api/admin/sanity/event-sync/route.ts':
    'shared-secret constant-time compare; no admin session (Sanity webhook)',
}

describe('route guards (static inventory)', () => {
  it('every /api/admin handler file checks the caller (admin session or a documented alternative)', () => {
    const files = routeFiles('app/api/admin')
    // Sanity: the sweep must actually find the routes, or the test is vacuously green.
    expect(files.length).toBeGreaterThan(100)
    const missing = files.filter(
      (f) => !(f in ALLOW_UNGUARDED) && !ADMIN_GUARD.test(readFileSync(f, 'utf8')),
    )
    expect(missing).toEqual([])
  })

  it('every allow-listed exception still exists (no stale entries hiding a gap)', () => {
    const files = new Set(routeFiles('app/api/admin'))
    for (const f of Object.keys(ALLOW_UNGUARDED)) {
      expect(files.has(f), `${f} is allow-listed but no longer exists`).toBe(true)
    }
  })

  it('every cron route calls guardCron as its first statement', () => {
    // Cron handlers live one directory deep: app/api/cron/<name>/route.ts.
    const files = routeFiles('app/api/cron').filter((f) => /app\/api\/cron\/[^/]+\/route\.ts$/.test(f))
    expect(files.length).toBeGreaterThan(10)
    for (const f of files) {
      const body = readFileSync(f, 'utf8').split(/export async function GET[^{]*\{/)[1] ?? ''
      expect(body.trimStart().startsWith('const blocked = guardCron(req)'), f).toBe(true)
    }
  })
})
