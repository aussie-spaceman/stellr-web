// The id-bearing routes of the route manifest: the input to the generated
// cross-tenant / IDOR suite (multi-tenant plan S2 "Cross-tenant and IDOR
// generator", carried into S4). test/idor/idor-routes.test.ts emits one case
// per target and asserts the case count equals the target count.
//
// Test-only, like route-ast.ts (it pulls in the TypeScript compiler).
//
// A route handler is id-bearing when a caller can name a record with it:
//   - its path has a dynamic segment (`[id]`, `[slug]`, `[...path]`), or
//   - it reads an id-like query parameter or body field (an id, slug, token,
//     storage path, reference or email, top-level or in a body array), found
//     by parsing the file (route-ast.ts requestIdInputs).
// Pages are not targets yet: they render, they do not return data, and the
// data they read goes through the same lib code the handlers use. S5 adds a
// page pass when tenant hosts exist (docs/SECURITY-route-manifest.md).
import { readFileSync } from 'node:fs'
import { ROUTE_MANIFEST, type RouteClass } from './route-manifest'
import { HTTP_METHODS, analyzeRoute, requestIdInputs } from './route-ast'

export interface IdorTarget {
  /** The route file, as keyed in ROUTE_MANIFEST. */
  file: string
  cls: RouteClass
  /** The URL path pattern, e.g. `/api/members/teams/[id]`. */
  urlPattern: string
  /** Dynamic path segment names, in order (`...path` for a catch-all). */
  segments: string[]
  /** Id-like query parameters the handler reads. */
  query: string[]
  /** Id-like body fields the handler reads (`items[].variantId` for a nested one). */
  body: string[]
  /** The other body fields it reads: filled in so request validation lets the ids through. */
  fill: string[]
  /** The exported HTTP method handlers. */
  methods: string[]
}

const ROUTE_FILE = /(^|\/)route\.(ts|tsx)$/

/** `app/(stellr)/(public)/api/x/[id]/route.ts` → `/api/x/[id]`. */
export function urlPatternOf(file: string): string {
  const parts = file
    .replace(/^app\//, '')
    .replace(ROUTE_FILE, '')
    .split('/')
    .filter((p) => p && !/^\(.*\)$/.test(p) && !p.startsWith('@'))
  return '/' + parts.join('/')
}

/** Dynamic segment names of a route file: `[id]` → id, `[...path]` → ...path. */
export function segmentsOf(file: string): string[] {
  return [...file.matchAll(/\[(\[?)(\.\.\.)?([^\]]+)\]?\]/g)].map((m) => (m[2] ? `...${m[3]}` : m[3]))
}

export function idorTargetFor(file: string, cls: RouteClass, src: string): IdorTarget | null {
  const segments = segmentsOf(file)
  const { query, body, fill } = requestIdInputs(file, src)
  if (segments.length === 0 && query.length === 0 && body.length === 0) return null
  const methods = analyzeRoute(file, src)
    .handlers.map((h) => h.name)
    .filter((m) => (HTTP_METHODS as readonly string[]).includes(m) && m !== 'HEAD' && m !== 'OPTIONS')
  if (methods.length === 0) return null
  return { file, cls, urlPattern: urlPatternOf(file), segments, query, body, fill, methods: [...new Set(methods)].sort() }
}

/** The classes the staff personas run against. */
const CREW_PERSONA_CLASSES: readonly RouteClass[] = ['tenant_crew', 'platform_admin', 'platform_destined']

/**
 * Every route handler classed tenant_crew, platform_admin or platform_destined, id-bearing
 * or not: a list or export names no id, and has to stay inside one tenant all the same.
 * Pages are not here; B10(c) covers what a page renders.
 */
export function crewTargets(
  read: (file: string) => string = (f) => readFileSync(f, 'utf8'),
  manifest: Record<string, RouteClass> = ROUTE_MANIFEST,
): IdorTarget[] {
  const out: IdorTarget[] = []
  for (const [file, cls] of Object.entries(manifest)) {
    if (!ROUTE_FILE.test(file) || !CREW_PERSONA_CLASSES.includes(cls)) continue
    const src = read(file)
    const methods = analyzeRoute(file, src)
      .handlers.map((h) => h.name)
      .filter((m) => (HTTP_METHODS as readonly string[]).includes(m) && m !== 'HEAD' && m !== 'OPTIONS')
    if (methods.length === 0) throw new Error(`${file} is classed ${cls} but exports no handler the personas can run`)
    const { query, body, fill } = requestIdInputs(file, src)
    out.push({ file, cls, urlPattern: urlPatternOf(file), segments: segmentsOf(file), query, body, fill, methods: [...new Set(methods)].sort() })
  }
  return out.sort((a, b) => a.file.localeCompare(b.file))
}

/** Every id-bearing route handler file in the manifest, sorted by file. */
export function idorTargets(read: (file: string) => string = (f) => readFileSync(f, 'utf8')): IdorTarget[] {
  const out: IdorTarget[] = []
  for (const [file, cls] of Object.entries(ROUTE_MANIFEST)) {
    if (!ROUTE_FILE.test(file)) continue
    const t = idorTargetFor(file, cls, read(file))
    if (t) out.push(t)
  }
  return out.sort((a, b) => a.file.localeCompare(b.file))
}
