// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { exportedNames } from '@/lib/security/route-ast'
import {
  LEGACY_IDIOMS,
  ROLE_TABLE_MANAGERS,
  baselineOf,
  checkSince,
  droppedIdioms,
  idiomDiff,
  isScanned,
  measureIdioms,
  nextIdiomFiles,
  readIdiomBaseline,
  selectsFromRoleTable,
  sitesGrew,
  totalsOf,
} from '../scripts/authz-idioms.mjs'
import { collectSources } from '../scripts/s5-inventory.mjs'

// S5 C5a: the legacy ways of deciding "admin, staff or event manager" move onto
// lib/authz, feature area by feature area, and the count reaches 0 at C25. A new
// site fails here; a removed one must leave the baseline, so the count only falls.
// No count is written in this file: the only number is the generated baseline.
//
// These tests compare the tree with the baseline in the same tree, so they cannot see
// a baseline raised with --allow-grow. CI's "Authz ratchet" step compares it with the
// merge base instead. A file added to ROLE_TABLE_MANAGERS or SKIP_FILE also lowers the
// count: only code-owner review of scripts/authz-idioms.mjs catches that.

const HOW = 'Use lib/authz. A removed site shrinks the ratchet: npx tsx scripts/authz-idioms.mjs --write'

type Files = Record<string, Record<string, number>>

/** Measure one file. A wrapper's definition can be passed alongside. */
const sites = (file: string, src: string, extra: Record<string, string> = {}): Record<string, number> =>
  (measureIdioms(new Map([[file, src], ...Object.entries(extra)])) as Files)[file] ?? {}

describe('legacy-idiom ratchet', () => {
  let live: Files
  const baseline = readIdiomBaseline(process.cwd())

  beforeAll(() => {
    live = measureIdioms(collectSources(process.cwd()))
  }, 120_000)

  it('has a committed baseline', () => {
    expect(baseline).not.toBeNull()
  })

  it('no new legacy site', () => {
    expect(idiomDiff(baseline, live).added, HOW).toEqual([])
  })

  it('the baseline lists no site that has gone', () => {
    expect(idiomDiff(baseline, live).stale, HOW).toEqual([])
  })

  it('the baseline is exactly what the script writes for this tree', () => {
    // Hand-edited totals, or an idiom list the baseline was not generated from, fail here.
    expect(baseline).toEqual(JSON.parse(JSON.stringify(baselineOf(live))))
  })

  it('a synthetic new importer fails', () => {
    const file = 'app/api/admin/zz-synthetic/route.ts'
    const src = "import { isAdminClaims } from '@/lib/admin-auth'\nexport const GET = (c) => isAdminClaims(c)\n"
    const measured = { ...live, ...(measureIdioms(new Map([[file, src]])) as Files) }
    expect(idiomDiff(baseline, measured).added).toEqual([`${file}: isAdminClaims 0 -> 1`])
  })

  it('every listed helper is exported from the file named, so a typo cannot read as 0', () => {
    for (const idiom of LEGACY_IDIOMS) {
      if (!idiom.file) continue
      const src = readFileSync(idiom.file, 'utf8')
      expect(exportedNames(idiom.file, src), idiom.id).toContain(idiom.id)
    }
  })

  it('every role-table screen exists, says why it is exempt, and has a read to exempt', () => {
    for (const [file, why] of Object.entries(ROLE_TABLE_MANAGERS)) {
      expect(existsSync(file), file).toBe(true)
      expect((why as string).length, file).toBeGreaterThan(15)
      // An entry with no read would quietly excuse the first one added there.
      expect(selectsFromRoleTable(file, readFileSync(file, 'utf8')), file).toBe(true)
    }
  })

  it('the sweep is not blind: it reads the app, the proxy, the shell and the audiences', () => {
    // A walker that stopped seeing these would shrink the count for the wrong reason.
    const scanned = [...collectSources(process.cwd()).keys()].filter(isScanned)
    expect(scanned.length).toBeGreaterThan(500)
    for (const file of ['proxy.ts', 'components/layout/NavUserButton.tsx', 'lib/notify.ts', 'app/api/cron/weekly-digest/route.ts']) {
      expect(scanned, file).toContain(file)
    }
  })
})

describe('named helpers', () => {
  const file = 'app/api/admin/x/route.ts'

  it('counts each reference, whatever the import form', () => {
    expect(sites(file, "import { isAdminClaims } from '@/lib/admin-auth'\nisAdminClaims(a); isAdminClaims(b)")).toEqual({ isAdminClaims: 2 })
    expect(sites(file, "import { isAdminClaims as ok } from '@/lib/admin-auth'\nok(a)")).toEqual({ isAdminClaims: 1 })
    expect(sites(file, "import * as a from '@/lib/admin-auth'\na.currentUserIsAdmin()")).toEqual({ currentUserIsAdmin: 1 })
    expect(sites('lib/x.ts', "import { requireEventAccess } from './event-access'\nrequireEventAccess()")).toEqual({ requireEventAccess: 1 })
    expect(sites(file, "async function f() { const { isCrewRole } = await import('@/lib/admin-auth'); return isCrewRole(r) }")).toEqual({ isCrewRole: 1 })
    expect(sites(file, "async function f() { const m = await import('@/lib/admin-auth'); return m.isAdminClaims(c) }")).toEqual({ isAdminClaims: 1 })
    expect(sites(file, "export { isAdminClaims } from '@/lib/admin-auth'")).toEqual({ isAdminClaims: 1 })
    expect(sites(file, "import { isAdminClaims } from '@/lib/admin-auth'\nexport { isAdminClaims }")).toEqual({ isAdminClaims: 1 })
    expect(sites(file, "import { isAdminClaims } from '@/lib/admin-auth'\nlist.filter(isAdminClaims); x({ isAdminClaims })")).toEqual({ isAdminClaims: 2 })
    expect(sites(file, "async function f() { return (await import('@/lib/admin-auth')).isAdminClaims(c) }")).toEqual({ isAdminClaims: 1 })
    expect(sites(file, "import('@/lib/admin-auth').then((m) => m.isAdminClaims(c))")).toEqual({ isAdminClaims: 1 })
    expect(sites(file, "import('@/lib/admin-auth').then(({ isAdminClaims: ok }) => ok(c))")).toEqual({ isAdminClaims: 1 })
    expect(sites(file, "import * as a from '@/lib/admin-auth'\nconst { isAdminClaims: ok } = a\nok(c)")).toEqual({ isAdminClaims: 1 })
    expect(sites(file, "async function f() { const m = await import('@/lib/admin-auth'); const { isCrewRole } = m; return isCrewRole(r) }")).toEqual({ isCrewRole: 1 })
  })

  it('counts lib/authz page.requireAdmin, which does not confine an event manager', () => {
    const one = { pageRequireAdmin: 1 }
    expect(sites(file, "import { page } from '@/lib/authz'\nawait page.requireAdmin()")).toEqual(one)
    expect(sites(file, "import { page as p } from '@/lib/authz'\nawait p.requireAdmin()")).toEqual(one)
    expect(sites(file, "import { authz } from '@/lib/authz'\nawait authz.page.requireAdmin()")).toEqual(one)
    expect(sites(file, "import * as a from '@/lib/authz'\nawait a.page.requireAdmin()")).toEqual(one)
    expect(sites(file, "import { authz } from '@/lib/authz'\nconst p = authz.page\nawait p.requireAdmin()")).toEqual(one)
    expect(sites(file, "import { page } from '@/lib/authz'\nconst { requireAdmin } = page\nawait requireAdmin()")).toEqual(one)
    expect(sites(file, "async function f() { const { page } = await import('@/lib/authz'); await page.requireAdmin() }")).toEqual(one)
    // The confining adapters, and anything else that happens to be called this.
    expect(sites(file, "import { page } from '@/lib/authz'\nawait page.requireStellrAdmin(); await page.requireTenantAdmin(); await page.requireEventSection()")).toEqual({})
    expect(sites(file, "import { page } from '@/lib/other'\nawait page.requireAdmin()")).toEqual({})
    expect(sites(file, 'const page = {}; page.requireAdmin()')).toEqual({})
  })

  it('counts the definition, so 0 means the helper has gone', () => {
    expect(sites('lib/admin-auth.ts', 'export function isAdminClaims(c) { return false }')).toEqual({ isAdminClaims: 1 })
    expect(sites('lib/admin-auth.ts', 'export function isAdminClaims(c) { return false }\nexport const b = (c) => isAdminClaims(c)')).toEqual({ isAdminClaims: 2 })
  })

  it('ignores comments, strings, keys, look-alike modules and same-file look-alikes', () => {
    expect(sites(file, "// isAdminClaims(c)\nexport const a = 'requireAdminPage'")).toEqual({})
    expect(sites(file, "import { isAdminClaims } from '@/lib/not-admin-auth'\nisAdminClaims(a)")).toEqual({})
    expect(sites(file, 'function isAdminClaims() { return true }\nisAdminClaims()')).toEqual({})
    expect(sites(file, "import { requireEventAccess } from '@/lib/authz'\nrequireEventAccess()")).toEqual({})
    expect(sites(file, "import * as a from '@/lib/admin-auth'\nconst o = { isAdminClaims: 1 }; o.isAdminClaims; a.DUTY_SCOPES")).toEqual({})
  })

  it('scans neither lib/authz, tests, stories nor scripts', () => {
    const src = "import { isAdminClaims } from '@/lib/admin-auth'\nisAdminClaims(a)"
    for (const f of ['lib/authz.ts', 'lib/authz/decide.ts', 'lib/x.test.ts', 'test/x.ts', 'e2e/x.ts', 'components/x.stories.tsx', 'scripts/set-admin.ts']) {
      expect(isScanned(f), f).toBe(false)
      expect(sites(f, src), f).toEqual({})
    }
    for (const f of ['lib/authz-lookalike.ts', 'proxy.ts', 'lib/x.ts', 'components/x.tsx']) expect(isScanned(f), f).toBe(true)
  })
})

describe('domain wrappers', () => {
  const def = 'lib/scholarship-admin.ts'
  const caller = 'app/api/admin/scholarships/route.ts'
  const callerSrc = "import { requireScholarshipAdmin } from '@/lib/scholarship-admin'\nrequireScholarshipAdmin(); requireScholarshipAdmin()"
  const legacy = "import { isAdminClaims } from '@/lib/admin-auth'\nimport { auth } from '@clerk/nextjs/server'\nexport async function requireScholarshipAdmin() { const { sessionClaims } = await auth(); return isAdminClaims(sessionClaims) }"
  const inline = "import { auth } from '@clerk/nextjs/server'\nexport async function requireScholarshipAdmin() { const { sessionClaims } = await auth(); return sessionClaims?.metadata?.role === 'admin' }"
  const viaHelper = "import { isAdminClaims } from '@/lib/admin-auth'\nfunction check(c) { return isAdminClaims(c) }\nexport async function requireScholarshipAdmin() { return check(c) }"
  const converted = "import { isStellrAdmin } from '@/lib/authz'\nexport async function requireScholarshipAdmin() { return isStellrAdmin() }"

  it('counts a call site while the wrapper rests on a legacy check', () => {
    expect(sites(caller, callerSrc, { [def]: legacy })).toEqual({ requireScholarshipAdmin: 2 })
    expect(sites(caller, callerSrc, { [def]: inline })).toEqual({ requireScholarshipAdmin: 2 })
    expect(sites(caller, callerSrc, { [def]: viaHelper })).toEqual({ requireScholarshipAdmin: 2 })
  })

  it('drops the call sites once it is re-implemented over lib/authz', () => {
    expect(sites(caller, callerSrc, { [def]: converted })).toEqual({})
  })

  it('counts them when the definition cannot be read', () => {
    expect(sites(caller, callerSrc)).toEqual({ requireScholarshipAdmin: 2 })
  })

  it('never counts the wrapper in its own file, only the check under it', () => {
    expect(sites(def, legacy, {})).toEqual({ isAdminClaims: 1 })
    expect(sites(def, converted, {})).toEqual({})
  })
})

describe('found by shape', () => {
  const file = 'app/api/admin/x/route.ts'

  it('sees every way of reading the Clerk role', () => {
    const one = { clerkRoleRead: 1 }
    expect(sites(file, 'const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role')).toEqual(one)
    expect(sites(file, "if (sessionClaims?.metadata?.role !== 'admin') x()")).toEqual(one)
    expect(sites(file, 'const r = (await c.users.getUser(id)).publicMetadata?.role')).toEqual(one)
    expect(sites(file, 'const r = (u.publicMetadata as { role?: unknown } | null)?.role')).toEqual(one)
    expect(sites(file, "const r = user.publicMetadata['role']")).toEqual(one)
    expect(sites(file, 'const meta = sessionClaims?.metadata\nconst r = meta?.role')).toEqual(one)
    expect(sites(file, 'const { role } = sessionClaims.metadata')).toEqual(one)
    expect(sites(file, 'const { role: r } = user.publicMetadata')).toEqual(one)
    expect(sites(file, 'const { sessionClaims: c } = await auth(); const r = c?.metadata?.role')).toEqual(one)
    expect(sites(file, 'const { publicMetadata } = await currentUser(); const r = publicMetadata.role')).toEqual(one)
    expect(sites(file, 'const { publicMetadata: pm } = user; const r = pm.role')).toEqual(one)
    expect(sites(file, 'const { publicMetadata: pm } = user; const { role } = pm')).toEqual(one)
    expect(sites(file, 'function roleOf(claims) { return claims?.metadata?.role }')).toEqual(one)
    expect(sites(file, 'const roleOf = (sessionClaims) => (sessionClaims?.metadata as { role?: string })?.role')).toEqual(one)
  })

  it('does not take a role from anywhere else for a Clerk role', () => {
    expect(sites(file, "const b = await req.json(); if (b.role === 'admin') x()")).toEqual({})
    expect(sites(file, 'const r = row.role')).toEqual({})
    expect(sites(file, 'const r = session.metadata.role')).toEqual({})
    expect(sites('lib/x.ts', 'const claims = decode(jwt); const r = claims.role')).toEqual({})
    expect(sites(file, 'const { role } = await req.json()')).toEqual({})
  })

  it('sees a literal list of the two portal roles', () => {
    expect(sites('lib/deletion/x.ts', "const s = new Set(['admin', 'event_manager'])")).toEqual({ portalRoleList: 1 })
    expect(sites(file, "if (['event_manager', 'admin'].includes(r)) x()")).toEqual({ portalRoleList: 1 })
    expect(sites(file, "const a = ['admin', 'staff']; const b = 'event_manager'")).toEqual({})
  })

  it('counts a select from a role table, not a write, and not on its own screen', () => {
    expect(sites('lib/x.ts', "db.from('admin_duties').select('scopes')")).toEqual({ roleTableRead: 1 })
    expect(sites('lib/x.ts', "await db\n  .from('event_manager_assignments')\n  .select('event_slug')\n  .eq('a', b)")).toEqual({ roleTableRead: 1 })
    expect(sites('lib/x.ts', "db.from('admin_duties').delete().eq('a', b); db.from('admin_duties').upsert(r)")).toEqual({})
    expect(sites('lib/x.ts', "db.from('members').select('id')")).toEqual({})
    expect(sites('app/api/admin/event-managers/route.ts', "db.from('event_manager_assignments').select('id')")).toEqual({})
    expect(sites('lib/x.ts', "const q = db.from('admin_duties'); q.select('scopes')")).toEqual({ roleTableRead: 1 })
    expect(sites('lib/x.ts', "const T = 'admin_duties'; db.from(T).select('scopes')")).toEqual({ roleTableRead: 1 })
    expect(sites('lib/x.ts', "const q = db.from('members'); q.select('id')")).toEqual({})
    expect(sites('lib/x.ts', "db.from('admin_duties').upsert(r).select('id')")).toEqual({})
  })
})

describe('the page.requireAdmin swap (codemod T4)', () => {
  const page = 'app/(stellr)/(admin)/admin/x/page.tsx'
  const baseline = { files: { [page]: { requireAdminPage: 1 }, 'lib/a.ts': { isCrewRole: 1 } } }
  const swapped = { [page]: { pageRequireAdmin: 1 }, 'lib/a.ts': { isCrewRole: 1 } }

  it('is neither growth nor progress: the file still holds one site to convert', () => {
    expect(idiomDiff(baseline, swapped)).toEqual({ added: [], stale: [] })
    expect(nextIdiomFiles(baseline, swapped)).toEqual(swapped)
    expect(totalsOf(nextIdiomFiles(baseline, swapped)).sites).toBe(totalsOf(baseline.files).sites)
  })

  it('cannot add one, in that file or a new one', () => {
    const more = { ...swapped, [page]: { pageRequireAdmin: 2 } }
    expect(idiomDiff(baseline, more).added).toEqual([`${page}: requireAdminPage 1 -> 2`])
    expect(nextIdiomFiles(baseline, more)[page]).toEqual({ pageRequireAdmin: 1 })
    const other = { ...swapped, 'app/(stellr)/(admin)/admin/y/page.tsx': { pageRequireAdmin: 1 } }
    expect(idiomDiff(baseline, other).added).toEqual(['app/(stellr)/(admin)/admin/y/page.tsx: requireAdminPage 0 -> 1'])
  })

  it('counts as progress only when the page moves on to a confining adapter', () => {
    const was = { files: swapped }
    const done = { 'lib/a.ts': { isCrewRole: 1 } }
    expect(idiomDiff(was, done).stale).toEqual([`${page}: requireAdminPage 1 -> 0`])
    expect(nextIdiomFiles(was, done)).toEqual(done)
  })
})

describe('growth against the merge base', () => {
  const base = { totals: { sites: 5 } }

  it('fails on more sites than the merge base, unless acknowledged', () => {
    expect(sitesGrew(base, { totals: { sites: 6 } })).toBe(true)
    expect(sitesGrew(base, { totals: { sites: 5 } })).toBe(false)
    expect(sitesGrew(base, { totals: { sites: 4 } })).toBe(false)
  })

  it('passes when the merge base has no baseline yet', () => {
    expect(sitesGrew(null, { totals: { sites: 6 } })).toBe(false)
  })

  describe('the --since check, in a real repository', () => {
    const FILE = 'test/baselines/authz-legacy-idioms.json'
    let root: string | null = null

    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args], {
        cwd: root as string,
        stdio: 'ignore',
      })
    const commit = (content: string | null) => {
      if (content !== null) {
        mkdirSync(path.join(root as string, path.dirname(FILE)), { recursive: true })
        writeFileSync(path.join(root as string, FILE), content)
      }
      git('add', '-A')
      git('commit', '--allow-empty', '-q', '-m', 'x')
    }
    const withSites = (n: number) => JSON.stringify({ totals: { sites: n } })
    /** A repository whose `base` branch holds `before`, with HEAD one commit on holding `after`. */
    const repo = (before: string | null, after: string) => {
      root = mkdtempSync(path.join(tmpdir(), 'authz-since-'))
      git('init', '-q', '-b', 'base')
      commit(before)
      git('checkout', '-q', '-b', 'work')
      commit(after)
    }

    afterEach(() => {
      if (root) rmSync(root, { recursive: true, force: true })
      root = null
      vi.unstubAllEnvs()
      vi.restoreAllMocks()
    })

    const run = (ref = 'base') => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      vi.spyOn(console, 'error').mockImplementation(() => {})
      return checkSince(root, ref)
    }

    it('fails a rise, and a rise the label acknowledges passes', () => {
      repo(withSites(5), withSites(6))
      expect(run()).toBe(1)
      vi.stubEnv('AUTHZ_RATCHET_GROW_OK', 'true')
      expect(run()).toBe(0)
    })

    it('passes a level or falling baseline', () => {
      repo(withSites(5), withSites(5))
      expect(run()).toBe(0)
      commit(withSites(4))
      expect(run()).toBe(0)
    })

    it('passes when the merge base has no baseline, however large this one is', () => {
      repo(null, withSites(500))
      expect(run()).toBe(0)
    })

    it('fails closed when the baseline at the merge base cannot be read', () => {
      repo('not json', withSites(1))
      expect(run()).toBe(1)
    })

    it('fails closed on a ref git cannot resolve, the label notwithstanding', () => {
      repo(withSites(5), withSites(5))
      vi.stubEnv('AUTHZ_RATCHET_GROW_OK', 'true')
      expect(run('no-such-ref')).toBe(1)
    })
  })
})

describe('baseline writer', () => {
  const baseline = { files: { 'lib/a.ts': { isAdminClaims: 2, isCrewRole: 1 }, 'lib/gone.ts': { isAdminClaims: 1 } } }

  it('only falls by default, and rises only when told to', () => {
    const measured = { 'lib/a.ts': { isAdminClaims: 3 }, 'lib/new.ts': { isAdminClaims: 1 } }
    expect(nextIdiomFiles(baseline, measured)).toEqual({ 'lib/a.ts': { isAdminClaims: 2 } })
    expect(nextIdiomFiles(baseline, measured, { allowGrow: true })).toEqual(measured)
  })

  it('reports growth and shrink per file and idiom', () => {
    const measured = { 'lib/a.ts': { isAdminClaims: 3 }, 'lib/new.ts': { isAdminClaims: 1 } }
    expect(idiomDiff(baseline, measured)).toEqual({
      added: ['lib/a.ts: isAdminClaims 2 -> 3', 'lib/new.ts: isAdminClaims 0 -> 1'],
      stale: ['lib/a.ts: isCrewRole 1 -> 0', 'lib/gone.ts: isAdminClaims 1 -> 0'],
    })
  })

  it('totals what is in the files', () => {
    expect(totalsOf(baseline.files)).toEqual({ files: 2, sites: 4, byIdiom: { isAdminClaims: 3, isCrewRole: 1 } })
  })

  it('an idiom cannot leave the list while it still has sites', () => {
    const list = LEGACY_IDIOMS.filter((i: { id: string }) => i.id !== 'isAdminClaims')
    const withIds = { idioms: ['isAdminClaims', 'isCrewRole'], files: baseline.files }
    expect(droppedIdioms(withIds, list)).toEqual(['isAdminClaims'])
    expect(droppedIdioms({ idioms: ['isAdminClaims'], files: { 'lib/a.ts': { isCrewRole: 1 } } }, list)).toEqual([])
    expect(droppedIdioms(withIds)).toEqual([])
  })
})
