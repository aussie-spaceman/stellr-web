// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// S0 (2 Nov 2026): every Clerk account the app creates goes through the COPPA
// guard (guardedEnsureClerkUser in lib/clerk-provisioning). This reads the
// source tree, so a new createUser / createInvitation call, a new importer of
// the provisioning module, or a call that forgets the date of birth fails CI
// instead of quietly opening a fourth way for a child under 13 to get a login.

const APP_DIRS = ['app', 'lib', 'components', 'packages']
// Run by hand or by CI, never by the app: scanned so a direct Clerk call there
// has to be named below too.
const OUTSIDE_DIRS = ['scripts', 'e2e', 'test']
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/
// Clerk's account-creating calls: a user, or any kind of invitation to sign up
// (createInvitation, createBulkInvitations, createOrganizationInvitation, …,
// which create the account on accept). Matched as method calls
// (`client.users.createUser(`), so a log line that merely names one is not counted.
const CREATES = /\.\s*create(?:User|[A-Za-z]*Invitation[A-Za-z]*)\s*\(/g
// The same calls in any other spelling: the bare name (`const { createUser } =
// client.users`), bracket access (`users['createUser'](`), or Clerk's REST API
// called directly. Outside lib/clerk-provisioning none may appear at all, in
// code (comments are ignored).
const OTHER_SPELLINGS = [
  /\bcreate(?:User|[A-Za-z]*Invitation[A-Za-z]*)\b/,
  /\[\s*['"`]create(?:User|[A-Za-z]*Invitation)/,
  /api\.clerk\.(?:com|dev)/,
]

// Operator scripts run by hand against a chosen Clerk instance, never by the
// app: neither is reachable by a registrant.
const SCRIPT_ALLOWLIST: Record<string, { count: number; why: string }> = {
  'scripts/seed-test-accounts.ts': { count: 1, why: 'seeds fixed adult E2E test accounts in the development instance' },
  'scripts/check-golive-config.mjs': { count: 1, why: 'go-live probe: creates and deletes one throwaway adult test user' },
}

// The only files allowed to import lib/clerk-provisioning, and how many guarded
// calls each makes. Individual registration, group registration (the
// organiser), group join, and the two member-invite paths (admin invite, group
// invite: lib/group-registration-followup and lib/group-account-invites reach
// Clerk only through lib/member-invite).
const IMPORTERS: Record<string, number> = {
  'app/api/register/individual/route.ts': 1,
  'app/api/register/group/route.ts': 1,
  'app/api/register/group-join/route.ts': 1,
  'lib/member-invite.ts': 2,
}
const GUARDED_EXPORTS = new Set(['guardedEnsureClerkUser', 'ensureClerkUserAndSignInToken'])

/** Source files under `dir`; test, spec and story files only when `withTests` (e2e's specs are its code). */
function walk(dir: string, out: string[] = [], withTests = false): string[] {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out, withTests)
    else if (SOURCE.test(name) && (withTests || !/\.(test|spec|stories)\.[^.]+$/.test(name))) out.push(p)
  }
  return out
}

const read = (f: string) => readFileSync(f, 'utf8')
const appFiles = APP_DIRS.flatMap((d) => walk(d))
const count = (s: string, re: RegExp) => (s.match(new RegExp(re.source, 'g')) ?? []).length
/** Source with block and line comments blanked. Rough (a `//` inside a string ends the line early), which can only hide code, never invent it. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

/** The text of the call starting at `from` (the index of its name), to its closing paren. */
function callText(src: string, from: number): string {
  const open = src.indexOf('(', from)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')' && --depth === 0) return src.slice(from, i + 1)
  }
  return src.slice(from)
}

/** The body of a top-level function declaration, up to the next top-level declaration. */
function functionBody(src: string, header: string): string {
  const start = src.indexOf(header)
  expect(start, `missing: ${header}`).toBeGreaterThanOrEqual(0)
  const rest = src.slice(start + header.length)
  const next = rest.search(/\n(export\s+)?(async\s+)?function\s|\nexport\s/)
  return next === -1 ? rest : rest.slice(0, next)
}

describe('every Clerk account sits behind the COPPA guard', () => {
  it('the app has exactly one account-creating Clerk call, inside lib/clerk-provisioning', () => {
    const hits = appFiles
      .map((f) => ({ f, n: count(read(f), CREATES) }))
      .filter((h) => h.n > 0)
    expect(hits).toEqual([{ f: 'lib/clerk-provisioning.ts', n: 1 }])
  })

  it('no other file reaches those calls by another spelling (bare name, bracket access, Clerk REST API)', () => {
    const hits = appFiles
      .filter((f) => f !== 'lib/clerk-provisioning.ts')
      .flatMap((f) => {
        const src = code(read(f))
        return OTHER_SPELLINGS.filter((re) => re.test(src)).map((re) => `${f}: ${re.source}`)
      })
    expect(hits).toEqual([])
  })

  it('the spelling check catches what it says it does', () => {
    const caught = (s: string) => OTHER_SPELLINGS.some((re) => re.test(code(s)))
    expect(caught('const { createUser } = client.users; await createUser({})')).toBe(true)
    expect(caught("await client.users['createUser']({})")).toBe(true)
    expect(caught('await client.invitations.createInvitation({})')).toBe(true)
    expect(caught("await fetch('https://api.clerk.com/v1/users', { method: 'POST' })")).toBe(true)
    // Not every 'create…' is Clerk's, and a comment is not code.
    expect(caught("const LIVE = ['created', 'sent', 'delivered']")).toBe(false)
    expect(caught('// never call createUser here')).toBe(false)
    expect(caught("const u = 'https://example.org' // createUser")).toBe(false)
  })

  it('outside the app (scripts, e2e, test), only the two named operator scripts call Clerk directly', () => {
    const hits = Object.fromEntries(
      OUTSIDE_DIRS.flatMap((d) => walk(d, [], true))
        .map((f) => [f, count(read(f), CREATES)])
        .filter(([, n]) => (n as number) > 0),
    )
    expect(hits).toEqual(Object.fromEntries(Object.entries(SCRIPT_ALLOWLIST).map(([f, v]) => [f, v.count])))
  })

  it('that call is in a private helper reached only from guardedEnsureClerkUser, after the age check', () => {
    const src = read('lib/clerk-provisioning.ts')
    expect(src).not.toMatch(/export\s+(async\s+)?function\s+findOrCreateClerkUser/)
    expect(src).not.toMatch(/export\s*\{[^}]*findOrCreateClerkUser/)
    expect(functionBody(src, 'async function findOrCreateClerkUser(')).toMatch(/\.createUser\s*\(/)

    // Defined once, called once — from the guard, below its under-13 check.
    expect(count(src, /findOrCreateClerkUser\s*\(/)).toBe(2)
    const guard = functionBody(src, 'export async function guardedEnsureClerkUser(')
    expect(guard).toMatch(/findOrCreateClerkUser\s*\(/)
    expect(guard.indexOf('isUnder13On(')).toBeGreaterThanOrEqual(0)
    expect(guard.indexOf('isUnder13On(')).toBeLessThan(guard.indexOf('findOrCreateClerkUser('))

    // The registration entry point goes through the guard, not around it.
    const reg = functionBody(src, 'export async function ensureClerkUserAndSignInToken(')
    expect(reg).toMatch(/guardedEnsureClerkUser\s*\(/)
    expect(reg).not.toMatch(/findOrCreateClerkUser\s*\(/)

    // And those two guarded entry points are the only functions it exports.
    const exportedFns = [...src.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1]).sort()
    expect(exportedFns).toEqual(['ensureClerkUserAndSignInToken', 'guardedEnsureClerkUser'])
    expect(src).not.toMatch(/export\s+(const|let|var)\s/)
  })

  it('only the four known files import lib/clerk-provisioning, and only its guarded exports', () => {
    const importers: Record<string, number> = {}
    for (const f of appFiles) {
      if (f === 'lib/clerk-provisioning.ts') continue
      const src = read(f)
      if (!/['"](@\/lib\/clerk-provisioning|\.\/clerk-provisioning)['"]/.test(src)) continue
      const named = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*clerk-provisioning['"]/g)]
        .flatMap((m) => m[1].split(','))
        .map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])
        .filter(Boolean)
      // Values must be guarded entry points; types are harmless.
      const values = named.filter((n) => !/^[A-Z]/.test(n))
      expect(values.every((n) => GUARDED_EXPORTS.has(n)), `${f} imports ${values.join(', ')}`).toBe(true)
      expect(src, `${f}: no dynamic or namespace import of clerk-provisioning`).not.toMatch(
        /import\s*\(\s*['"][^'"]*clerk-provisioning|import\s*\*\s*as\s+\w+\s+from\s*['"][^'"]*clerk-provisioning/,
      )
      importers[f] = count(src, /\b(guardedEnsureClerkUser|ensureClerkUserAndSignInToken)\s*\(/)
    }
    expect(importers).toEqual(IMPORTERS)
  })

  it('every guarded call passes the person\'s date of birth', () => {
    for (const f of Object.keys(IMPORTERS)) {
      const src = read(f)
      for (const m of src.matchAll(/\b(guardedEnsureClerkUser|ensureClerkUserAndSignInToken)\s*\(/g)) {
        const call = callText(src, m.index!)
        expect(call, `${f}: ${call}`).toMatch(/dateOfBirth/)
        if (m[1] === 'ensureClerkUserAndSignInToken') expect(call, `${f}: ${call}`).toMatch(/\bage\s*:/)
      }
    }
  })

  it('a login made outside the app (self-serve sign-up) is linked to a member row only after the same rule', () => {
    // The Clerk webhook and onboarding are the two places that tie such a login
    // to an existing member found by email. Each asks mayLinkLogin first.
    const webhook = code(read('app/api/webhooks/clerk/route.ts'))
    const link = webhook.indexOf('.update({ clerk_user_id: data.id')
    expect(link).toBeGreaterThan(0)
    expect(webhook.lastIndexOf('mayLinkLogin(', link)).toBeGreaterThan(webhook.indexOf("type === 'user.created'"))

    const onboarding = code(read('app/api/members/onboarding/route.ts'))
    const byEmail = onboarding.indexOf('.update({ ...profileUpdates, ...fillFromLogin(byEmail) })\n        .eq(\'id\', byEmail.id)')
    expect(byEmail).toBeGreaterThan(0)
    const gate = onboarding.indexOf('mayLinkLogin(')
    expect(gate).toBeGreaterThan(0)
    expect(gate).toBeLessThan(byEmail)
  })

  it('the admin adult-by-role pass is used only by the admin account invite', () => {
    const users = appFiles.filter((f) => /\badultByRole\b/.test(read(f))).sort()
    expect(users).toEqual(['lib/clerk-provisioning.ts', 'lib/member-invite.ts'])
    const invite = read('lib/member-invite.ts')
    expect(count(invite, /\badultByRole\s*:/)).toBe(1)
    expect(functionBody(invite, 'export async function sendAccountInvite(')).toMatch(/\badultByRole\s*:/)
  })
})
