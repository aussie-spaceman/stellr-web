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

  // deep review INT-9: 13 of 19 crons had no cron_runs ledger, so a failing
  // integration (membership expiry, drip, reminders, Apollo/HubSpot) returned
  // 200 with zeros and Vercel Hobby's 1h log retention erased the only trace.
  // Every cron must record its run via startCronRun (or the runCron helper, if
  // one is introduced later) so "did it run, and did it fail?" is answerable
  // from the DB. A stale allow-list entry is the one way this can hide a gap.
  it('every cron route records its run in cron_runs (startCronRun)', () => {
    const files = routeFiles('app/api/cron').filter((f) => /app\/api\/cron\/[^/]+\/route\.ts$/.test(f))
    expect(files.length).toBeGreaterThan(10)
    const missing = files.filter((f) => {
      const src = readFileSync(f, 'utf8')
      return !/\bstartCronRun\b|\brunCron\b/.test(src)
    })
    expect(missing).toEqual([])
  })

  // S0 (Nov 2026): getCurrentMember() follows a live view-as ticket and returns
  // the member an admin is viewing as. An admin route that used it to name the
  // actor recorded that member (often a minor) as the person who revoked or
  // issued. Admin routes name the actor with getSignedInMember().
  it('no /api/admin route resolves the acting admin with getCurrentMember', () => {
    const files = routeFiles('app/api/admin')
    expect(files.length).toBeGreaterThan(100)
    // The import, not the name: comments explaining the rule may mention it.
    const imports = /import\s*\{[^}]*\bgetCurrentMember\b[^}]*\}\s*from/
    const offenders = files.filter((f) => imports.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})

// S1 (Nov 2026): webhooks have no session either, so each one must prove the
// caller another way. Every webhook route is listed here with how it does that
// and a pattern its source must contain; a new webhook fails until it is added.
const WEBHOOKS: Record<string, { how: string; pattern: RegExp }> = {
  'app/api/webhooks/resend/route.ts': {
    how: 'svix signature with RESEND_WEBHOOK_SECRET; refused when the secret is unset',
    pattern: /new Webhook\(secret\)\.verify[\s\S]*RESEND_WEBHOOK_SECRET|RESEND_WEBHOOK_SECRET[\s\S]*new Webhook\(secret\)\.verify/,
  },
  'app/api/webhooks/clerk/route.ts': { how: 'svix signature', pattern: /\.verify\(/ },
  'app/api/webhooks/docusign/route.ts': { how: 'DocuSign Connect HMAC', pattern: /verifyConnectHmac/ },
  'app/api/webhooks/background/route.ts': { how: 'provider signature check', pattern: /verifyWebhook/ },
  'app/api/webhooks/recording/route.ts': { how: 'JaaS signature or legacy shared secret', pattern: /JAAS_WEBHOOK_SECRET/ },
  'app/api/webhooks/motion/route.ts': { how: 'HMAC, constant-time compare', pattern: /timingSafeEqual/ },
  'app/api/webhooks/apollo/route.ts': { how: 'shared secret, constant-time compare', pattern: /timingSafeEqual/ },
  'app/api/webhooks/sanity/route.ts': { how: 'shared secret; refused when unset', pattern: /SANITY_REVALIDATE_SECRET/ },
  'app/api/webhooks/google-sheets/route.ts': {
    how: 'acts only on a channel id it registered (sheet_watch_channels), unexpired',
    pattern: /sheet_watch_channels/,
  },
  'app/api/stripe/webhook/route.ts': { how: 'Stripe signature', pattern: /constructEvent/ },
  'app/api/printful/webhook/route.ts': { how: 'shared secret', pattern: /verifyPrintfulWebhook/ },
}

describe('webhook guards (static inventory)', () => {
  it('every webhook route is in the inventory and still verifies its caller', () => {
    const found = [
      ...routeFiles('app/api/webhooks'),
      ...routeFiles('app/api').filter((f) => /\/webhook\/route\.ts$/.test(f)),
    ]
    expect(found.length).toBeGreaterThan(5)
    const unlisted = found.filter((f) => !(f in WEBHOOKS))
    expect(unlisted).toEqual([])
    for (const [file, { pattern }] of Object.entries(WEBHOOKS)) {
      expect(pattern.test(readFileSync(file, 'utf8')), file).toBe(true)
    }
  })
})
