import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { config } from '@/proxy'
import { isPrivatePath } from '@/lib/private-routes'

// proxy-matcher-gated-prefixes.5. The matcher's first entry skips any URL with a
// static file extension, wherever it appears, so /admin/members/x.css would skip
// the proxy's admin role check. A third entry runs the proxy on the gated
// prefixes however a path ends. A new gated route folder must join that entry,
// or its paths fall back to the old behaviour. Nothing enforced that until this
// test, which reads the route folders from disk.
//
// Gated means the proxy does a job there that a page must not be left without:
//   - every top-level folder of the (admin), (member) and (flow) route groups:
//     the admin role gate, sign-in for members, and the single-task flows (pay,
//     join and signing links, surveys, check-in);
//   - every private link (lib/private-routes.ts) among the (public) pages, up to
//     its first dynamic segment: /credentials, /scholarship/offer and so on.

const ROOT = join(process.cwd(), 'app', '(stellr)')
const GATED_GROUPS = ['(admin)', '(member)', '(flow)']

// Folders in a gated group that hold one page and nothing beneath it. The extra
// matcher entry matters only for a path below the folder, and with no route
// there any such path is the not-found page. Each stays exempt only while that
// is true: the last test below fails when one gains a route beneath it.
const EXEMPT: Record<string, { dir: string; reason: string }> = {
  join: {
    dir: join(ROOT, '(member)', 'join'),
    reason: 'one page at /join; test/tenant-surface-routes.test.ts pins /join/x.png as skipping the proxy on a Stellr host',
  },
}

const isGroup = (name: string) => name.startsWith('(') && name.endsWith(')')
const isDynamic = (name: string) => name.startsWith('[')
const isRouteFile = (name: string) => /^(page|route)\.(tsx?|jsx?)$/.test(name)

/** True when `dir` holds a page or route handler at any depth. */
function hasRoute(dir: string): boolean {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && isRouteFile(entry.name)) return true
    if (entry.isDirectory() && !entry.name.startsWith('_') && hasRoute(join(dir, entry.name))) return true
  }
  return false
}

/** First URL segments under a route group: nested groups add no segment. */
function topSegments(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue
    const child = join(dir, entry.name)
    if (isGroup(entry.name)) out.push(...topSegments(child))
    else if (hasRoute(child)) out.push(entry.name)
  }
  return out
}

/**
 * The pages under `dir`, each as its static segments, a sample URL (dynamic
 * segments filled in) and the static prefix before its first dynamic segment.
 */
function pages(dir: string, segs: string[] = []): { sample: string; prefix: string }[] {
  const out: { sample: string; prefix: string }[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name)
    if (entry.isFile() && entry.name === 'page.tsx' && segs.length) {
      const firstDynamic = segs.findIndex(isDynamic)
      const fixed = firstDynamic === -1 ? segs : segs.slice(0, firstDynamic)
      out.push({
        sample: '/' + segs.map((s) => (isDynamic(s) ? 'sampletoken' : s)).join('/'),
        prefix: fixed.join('/'),
      })
    } else if (entry.isDirectory() && !entry.name.startsWith('_')) {
      out.push(...pages(child, isGroup(entry.name) ? segs : [...segs, entry.name]))
    }
  }
  return out
}

/** Drop any prefix that a shorter one in the list already covers. */
function minimal(prefixes: string[]): string[] {
  const unique = [...new Set(prefixes)].sort()
  return unique.filter((p) => !unique.some((q) => q !== p && p.startsWith(`${q}/`)))
}

const groupFolders = GATED_GROUPS.filter((g) => existsSync(join(ROOT, g))).flatMap((g) => topSegments(join(ROOT, g)))
const privatePublic = pages(join(ROOT, '(public)'))
  .filter((p) => isPrivatePath(p.sample) && p.prefix)
  .map((p) => p.prefix)
const GATED = minimal([...groupFolders, ...privatePublic]).filter((p) => !(p in EXEMPT))

const matches = (url: string) =>
  unstable_doesMiddlewareMatch({ config, url: `http://localhost:3000${url}`, headers: { host: 'localhost:3000' } })

/** The prefixes the matcher's gated entry names, read from its source. */
function matcherPrefixes(): string[] {
  const entry = config.matcher.find(
    (m): m is string => typeof m === 'string' && m.startsWith('/((?:') && m.endsWith(')(?:/.*)?)'),
  )
  if (!entry) throw new Error('proxy.ts config.matcher has no gated-prefix entry')
  return entry.slice('/((?:'.length, -')(?:/.*)?)'.length).split('|')
}

describe('every gated route folder runs the proxy, however its paths end', () => {
  it('finds the known gated folders on disk (walker sanity check)', () => {
    for (const known of ['admin', 'account', 'community', 'home', 'register', 'sign', 'survey', 'check-in', 'credentials', 'scholarship/offer']) {
      expect(GATED, known).toContain(known)
    }
    // Public pages that are not private links stay out.
    expect(GATED).not.toContain('about')
    expect(GATED).not.toContain('scholarship')
    expect(GATED).not.toContain('events')
  })

  it.each(GATED)('/%s is in the matcher\'s gated entry', (prefix) => {
    for (const path of [`/${prefix}/x.css`, `/${prefix}/x.png/y`, `/${prefix}/x.js`]) {
      expect(
        matches(path),
        `${path} skips the proxy. Add '${prefix}' to the gated-prefix entry of proxy.ts config.matcher.`,
      ).toBe(true)
    }
  })

  it.each(Object.entries(EXEMPT))('exempts /%s only while it has no route beneath its own page', (prefix, { dir, reason }) => {
    expect(groupFolders, `${prefix}: ${reason}`).toContain(prefix)
    const below = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && hasRoute(join(dir, e.name)))
    expect(
      below.map((e) => e.name),
      `/${prefix} now has routes beneath it, so its exemption no longer holds. Add '${prefix}' to the gated-prefix entry of proxy.ts config.matcher and drop it from EXEMPT.`,
    ).toEqual([])
  })

  it('names no prefix in the gated entry that has no gated folder behind it', () => {
    const stale = matcherPrefixes().filter((p) => !GATED.some((g) => p === g || p.startsWith(`${g}/`)))
    expect(stale, `Gated matcher prefixes with no gated route folder: ${stale.join(', ')}`).toEqual([])
  })
})
