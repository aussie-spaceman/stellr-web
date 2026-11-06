// The tenant-host route surface (S5, multi-tenant plan): which routes a tenant
// host (a host mapped to a tenant in tenant_domains) may serve. One
// source for the proxy's routing decision and for the Social Media Minimum Age
// (SMMA) guardrail that keeps community off tenant hosts.
//
// Data plus a matcher, pinned by test/tenant-surface-routes.test.ts. proxy.ts
// consults it (slice B5) only for a host mapped to a tenant, which needs
// TENANT_ROUTING_ENABLED. Stellr's own hosts (www, app, previews, localhost) never
// consult it; they serve every route exactly as today. The one thing proxy.ts
// reads from here on every request is isInternalTenantTreePath, a string check.
//
// Every entry in ROUTE_MANIFEST (lib/security/route-manifest.ts) takes exactly
// one decision here:
//   allow    reachable on a tenant host (the tenant comes from the host).
//   pending  wanted on tenant hosts, but not yet reviewed or not yet safe there.
//            Treated as denied until the owner rules and it moves to allow.
//   deny     never served on a tenant host. The reason says why.
//   bypass   the URL always skips the proxy matcher (proxy.ts config.matcher),
//            so the proxy cannot gate it: it answers on every host.
// The test fails when a manifest entry has no decision, or more than one, so a
// new route is denied on tenant hosts until someone classifies it here.
//
// Allow grants reachability only. It says nothing about what a page renders, and
// each handler must still check that the resource's tenant matches the host
// tenant. Handlers read by global id, slug or token until the codemod lanes
// convert them, so tenant hosts stay dark until the allowed routes pass the
// cross-tenant ratchet. The SMMA tests here prove route reachability; the
// import-closure lint (B8) covers what an allowed page pulls in.
//
// Matcher behaviour on Stellr hosts is unchanged by tenant routing. On every other
// host a matcher entry keyed on the host means only _next, api/img and api/csp-report
// skip the proxy. tenantHostRoute() below then decides, and a URL with a file
// extension under a routed first segment is denied, not treated as a static file.
//
// Final allow-list membership is an owner open question; the test enforces
// whatever is decided, and the pinned counts make every change a visible diff.

import { ROUTE_MANIFEST } from '@/lib/security/route-manifest'

export type TenantSurfaceDecision = 'allow' | 'pending' | 'deny' | 'bypass'

/** A rule over manifest file paths: an exact file, or a directory prefix ending in '/'. */
export interface TenantSurfaceRule {
  readonly match: string
  readonly reason: string
}

// ── allow ───────────────────────────────────────────────────────────────
// Exact manifest files only (no prefixes), so a new file in an allowed area
// still has to be added here by name.

const FLOW = 'the participant flow an organiser runs: register, check in, sign, survey, team profile'
const AUTH = 'a participant signs in on the organiser host (relative Clerk URLs)'
const CREDENTIAL = 'a participant credential issued for a tenant event'
const LEGAL = 'the policy pages a participant must be able to read'
const ACCOUNT = "a participant's own onboarding and volunteer interest (decision 12)"

export const TENANT_SURFACE_ALLOW: readonly TenantSurfaceRule[] = [
  // (flow) pages, 16
  { match: 'app/(flow)/check-in/[slug]/code/page.tsx', reason: FLOW },
  { match: 'app/(flow)/check-in/[slug]/page.tsx', reason: FLOW },
  { match: 'app/(flow)/check-in/page.tsx', reason: FLOW },
  { match: 'app/(flow)/register/[slug]/confirmation/page.tsx', reason: FLOW },
  { match: 'app/(flow)/register/[slug]/group/page.tsx', reason: FLOW },
  { match: 'app/(flow)/register/[slug]/individual/page.tsx', reason: FLOW },
  { match: 'app/(flow)/register/[slug]/join/[token]/page.tsx', reason: FLOW },
  { match: 'app/(flow)/register/[slug]/page.tsx', reason: FLOW },
  { match: 'app/(flow)/register/[slug]/pay-seat/[token]/page.tsx', reason: FLOW },
  { match: 'app/(flow)/register/[slug]/pay/[token]/page.tsx', reason: FLOW },
  { match: 'app/(flow)/sign/copy/page.tsx', reason: FLOW },
  { match: 'app/(flow)/sign/page.tsx', reason: FLOW },
  { match: 'app/(flow)/survey/[token]/page.tsx', reason: FLOW },
  { match: 'app/(flow)/survey/[token]/stop-reminders/page.tsx', reason: FLOW },
  { match: 'app/(flow)/survey/event/[slug]/page.tsx', reason: FLOW },
  { match: 'app/(flow)/team-profile/[token]/page.tsx', reason: FLOW },
  // (auth) pages, 2
  { match: 'app/(auth)/sign-in/[[...sign-in]]/page.tsx', reason: AUTH },
  { match: 'app/(auth)/sign-up/[[...sign-up]]/page.tsx', reason: AUTH },
  // credentials, privacy, terms, account
  { match: 'app/(public)/credentials/[number]/page.tsx', reason: CREDENTIAL },
  { match: 'app/(public)/credentials/[number]/badge/route.tsx', reason: CREDENTIAL },
  { match: 'app/(public)/credentials/[number]/opengraph-image.tsx', reason: CREDENTIAL },
  { match: 'app/(public)/privacy/page.tsx', reason: LEGAL },
  { match: 'app/(public)/terms/page.tsx', reason: LEGAL },
  { match: 'app/(member)/account/onboarding/page.tsx', reason: ACCOUNT },
  // APIs behind the flow. Register paths appear here as data only: the
  // register lane owns their tenant handling.
  { match: 'app/api/register/group-join/route.ts', reason: FLOW },
  { match: 'app/api/register/group/route.ts', reason: FLOW },
  { match: 'app/api/register/individual/route.ts', reason: FLOW },
  { match: 'app/api/register/pay-seat/route.ts', reason: FLOW },
  { match: 'app/api/register/pay/route.ts', reason: FLOW },
  { match: 'app/api/sign/consent/route.ts', reason: FLOW },
  { match: 'app/api/sign/context/route.ts', reason: FLOW },
  { match: 'app/api/sign/copy/route.ts', reason: FLOW },
  { match: 'app/api/sign/decline/route.ts', reason: FLOW },
  { match: 'app/api/sign/document/route.ts', reason: FLOW },
  { match: 'app/api/sign/session/route.ts', reason: FLOW },
  { match: 'app/api/sign/submit/route.ts', reason: FLOW },
  { match: 'app/api/sign/viewed/route.ts', reason: FLOW },
  { match: 'app/api/survey/[token]/route.ts', reason: FLOW },
  { match: 'app/api/survey/[token]/stop-reminders/route.ts', reason: FLOW },
  { match: 'app/api/survey/[token]/submit/route.ts', reason: FLOW },
  { match: 'app/api/survey/event/[slug]/link/route.ts', reason: FLOW },
  { match: 'app/api/check-in/route.ts', reason: FLOW },
  { match: 'app/api/check-in-desk/manifest/route.ts', reason: FLOW },
  { match: 'app/api/team-profile/[token]/route.ts', reason: FLOW },
  { match: 'app/api/email/unsubscribe/route.ts', reason: 'the marketing opt-out from an email link, no session (CAN-SPAM, CASL)' },
  { match: 'app/api/credentials/[number]/events/route.ts', reason: CREDENTIAL },
  { match: 'app/api/credentials/[number]/pdf/route.ts', reason: CREDENTIAL },
  { match: 'app/api/credentials/[number]/visibility/route.ts', reason: CREDENTIAL },
  { match: 'app/api/volunteer/interest/route.ts', reason: ACCOUNT },
]

// ── pending ─────────────────────────────────────────────────────────────
// Wanted on tenant hosts, but not reviewed or not yet safe there. Denied until
// the owner rules on each; an allowed page that calls one degrades on a tenant
// host until then.

export const TENANT_SURFACE_PENDING: readonly TenantSurfaceRule[] = [
  {
    match: 'app/api/registrations/[id]/spreadsheet/route.ts',
    reason:
      "copies minors' health and emergency-contact data into a sheet in Stellr's Drive on an anyone-can-edit link; allow only once the export is tenant-scoped and has no public link",
  },
  {
    match: 'app/api/uploads/sign/route.ts',
    reason:
      'the upload purpose comes from the request body, so this path admits admin and community purposes; needs a per-purpose tenant-host gate and tenant-prefixed storage paths first',
  },
  {
    match: 'app/(member)/account/page.tsx',
    reason:
      'renders the community directory opt-in, Stellr store orders and the Stellr membership prompt; allow only with a tenant-host variant that removes them',
  },
  {
    match: 'app/api/consent/request/route.ts',
    reason:
      "a member's own guardian-consent request, but today it acts on the Stellr membership consent form only (lib/pending-consent); review before allowing",
  },
  {
    match: 'app/api/members/',
    reason:
      'the account page and register prefill (useMemberPrefill, MemberIdLookup) call member APIs; a reviewed subset moves to allow',
  },
  {
    match: 'app/api/schools/',
    reason: 'the register form school search (SchoolSearchInput) reads the Stellr school index',
  },
  {
    match: 'app/(public)/privacy/request/',
    reason: "a privacy request on a tenant host goes to the organiser's controller process, not yet designed",
  },
  {
    match: 'app/api/privacy-requests/',
    reason: "a privacy request on a tenant host goes to the organiser's controller process, not yet designed",
  },
]

// ── bypass ──────────────────────────────────────────────────────────────

export const TENANT_SURFACE_BYPASS: readonly TenantSurfaceRule[] = [
  {
    match: 'app/api/img/route.ts',
    reason: 'excluded from the proxy matcher (api/img): an image proxy, answers on every host and must read no tenant',
  },
  {
    match: 'app/api/csp-report/route.ts',
    reason: 'excluded from the proxy matcher (api/csp-report): the CSP report sink every host posts to',
  },
  {
    match: 'app/manifest.ts',
    reason:
      'served as /manifest.webmanifest, which the proxy matcher excludes by extension on a Stellr host; on a tenant host the proxy passes it through as a static file',
  },
  {
    match: 'app/app.webmanifest/route.ts',
    reason:
      'served as /app.webmanifest, which the proxy matcher excludes by extension on a Stellr host; on a tenant host the proxy passes it through as a static file',
  },
]

// ── deny ────────────────────────────────────────────────────────────────

const SMMA = 'community is Stellr-only under the Social Media Minimum Age guardrail: never on a tenant host'
const ADMIN =
  "Stellr's admin portal: its gate trusts a Clerk role valid on every host, so it stays off tenant hosts until lib/authz checks tenant membership"

export const TENANT_SURFACE_DENY: readonly TenantSurfaceRule[] = [
  {
    match: 'app/%5Ft/',
    reason: 'the internal tenant tree: reached only through the proxy rewrite, never by its own URL',
  },
  { match: 'app/(member)/community/', reason: SMMA },
  { match: 'app/api/community/', reason: SMMA },
  { match: 'app/(member)/home/', reason: `${SMMA} (home is the community landing)` },
  { match: 'app/(admin)/', reason: ADMIN },
  { match: 'app/api/admin/', reason: ADMIN },
  { match: 'app/api/cron/', reason: 'Vercel Cron calls the platform host only' },
  { match: 'app/api/webhooks/', reason: 'third parties call the platform host only' },
  { match: 'app/api/stripe/webhook/route.ts', reason: 'Stripe calls the platform host only' },
  { match: 'app/api/printful/webhook/route.ts', reason: 'Printful calls the platform host only' },
  { match: 'app/(public)/store/', reason: "Stellr's own store" },
  { match: 'app/api/store/', reason: "Stellr's own store" },
  { match: 'app/(public)/academy/', reason: "Stellr's own academy" },
  { match: 'app/(member)/campaigns/', reason: "Stellr's own campaigns" },
  { match: 'app/api/campaigns/', reason: "Stellr's own campaigns" },
  { match: 'app/(member)/join/', reason: 'Stellr membership' },
  { match: 'app/api/stripe/membership-checkout/route.ts', reason: 'Stellr membership billing' },
  { match: 'app/api/stripe/membership-invoice/route.ts', reason: 'Stellr membership billing' },
  { match: 'app/studio/', reason: "Stellr's Sanity Studio" },
  { match: 'app/sitemap.ts', reason: "Stellr's sitemap lists Stellr pages only" },
  { match: 'app/llms.txt/', reason: "Stellr's answer-engine summary" },
  { match: 'app/indexnow-key.txt/', reason: "Stellr's IndexNow key" },
  {
    match: 'app/robots.ts',
    reason: "Stellr's robots.txt; a tenant host answers TENANT_HOST_ROBOTS_TXT (disallow all) until S10",
  },
  // Stellr's own lead capture and marketing APIs.
  { match: 'app/api/asset-request/', reason: 'Stellr lead capture' },
  { match: 'app/api/contact/route.ts', reason: 'Stellr lead capture' },
  { match: 'app/api/host-event/route.ts', reason: 'Stellr lead capture' },
  { match: 'app/api/join-network/route.ts', reason: 'Stellr lead capture' },
  { match: 'app/api/lp-lead/route.ts', reason: 'Stellr lead capture' },
  { match: 'app/api/scholarship/route.ts', reason: 'Stellr scholarships' },
  { match: 'app/api/subscribe/route.ts', reason: 'Stellr newsletter' },
  { match: 'app/api/teacher-grant/route.ts', reason: 'Stellr lead capture' },
  { match: 'app/api/white-paper/route.ts', reason: 'Stellr lead capture' },
]

/**
 * The one fallback: a (public) page no rule above names is part of Stellr's
 * marketing site, so it is denied. It applies only when no explicit rule
 * matches; explicit rules may not overlap each other.
 */
export const TENANT_SURFACE_DENY_FALLBACK: TenantSurfaceRule = {
  match: 'app/(public)/',
  reason: "Stellr's marketing site",
}

/** What a tenant host answers for /robots.txt until S10 decides tenant indexing. */
export const TENANT_HOST_ROBOTS_TXT = 'User-agent: *\nDisallow: /\n'

// ── classification ──────────────────────────────────────────────────────

function ruleMatches(rule: TenantSurfaceRule, file: string): boolean {
  return rule.match.endsWith('/') ? file.startsWith(rule.match) : file === rule.match
}

const ORDERED: ReadonlyArray<readonly [TenantSurfaceDecision, readonly TenantSurfaceRule[]]> = [
  ['allow', TENANT_SURFACE_ALLOW],
  ['bypass', TENANT_SURFACE_BYPASS],
  ['pending', TENANT_SURFACE_PENDING],
  ['deny', TENANT_SURFACE_DENY],
]

export interface TenantSurfaceMatch {
  decision: TenantSurfaceDecision
  rule: TenantSurfaceRule
}

/** Every explicit rule (of any decision) that matches a manifest file. The test allows at most one. */
export function tenantSurfaceMatches(file: string): TenantSurfaceMatch[] {
  const out: TenantSurfaceMatch[] = []
  for (const [decision, rules] of ORDERED) {
    for (const rule of rules) if (ruleMatches(rule, file)) out.push({ decision, rule })
  }
  return out
}

/** The decision and its reason for a manifest file; null when unclassified (the test fails on that). */
export function classifyTenantSurface(file: string): TenantSurfaceMatch | null {
  const explicit = tenantSurfaceMatches(file)
  if (explicit.length > 0) return explicit[0]
  if (ruleMatches(TENANT_SURFACE_DENY_FALLBACK, file)) {
    return { decision: 'deny', rule: TENANT_SURFACE_DENY_FALLBACK }
  }
  return null
}

/** The decision for a manifest file; null when it is unclassified (the test fails on that). */
export function tenantSurfaceDecision(file: string): TenantSurfaceDecision | null {
  return classifyTenantSurface(file)?.decision ?? null
}

// ── URL matching ────────────────────────────────────────────────────────

/**
 * The URL pattern a manifest file serves, as a RegExp source. Route groups
 * `(x)` drop out; `[x]` is one segment, `[...x]` one or more, `[[...x]]` zero
 * or more. A metadata image may carry Next's `-<hash>` suffix.
 */
export function urlPatternForFile(file: string): string {
  const parts = file.replace(/^app\//, '').split('/')
  const leaf = parts.pop() ?? ''
  const segments = parts.filter((p) => !/^\(.+\)$/.test(p))
  if (/^opengraph-image\.tsx?$/.test(leaf)) segments.push('opengraph-image')
  else if (!/^(page|route)\.tsx?$/.test(leaf)) {
    throw new Error(`tenant-surface: no URL rule for ${file}`)
  }

  let src = ''
  for (const seg of segments) {
    if (/^\[\[\.\.\..+\]\]$/.test(seg)) src += '(?:/[^/]+)*'
    else if (/^\[\.\.\..+\]$/.test(seg)) src += '(?:/[^/]+)+'
    else if (/^\[.+\]$/.test(seg)) src += '/[^/]+'
    else if (seg === 'opengraph-image') src += '/opengraph-image(?:-[A-Za-z0-9]+)?'
    else src += '/' + seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return `^${src === '' ? '/' : src}$`
}

/** The manifest files allowed on a tenant host. */
export function allowedTenantFiles(): string[] {
  return Object.keys(ROUTE_MANIFEST).filter((f) => tenantSurfaceDecision(f) === 'allow')
}

let allowedPatterns: RegExp[] | null = null
function patterns(): RegExp[] {
  allowedPatterns ??= allowedTenantFiles().map((f) => new RegExp(urlPatternForFile(f)))
  return allowedPatterns
}

/**
 * Whether a raw pathname names the internal tenant tree (/_t/{slug}/…), which is
 * reached only through the proxy's rewrite and is never requested directly.
 *
 * It compares the decoded first segment, so every spelling Next could route is
 * caught: /_t, /%5Ft, /%5ft, /_%74, /%5F%74, and a double encoding. It is
 * case-insensitive, and runs on every proxied request, so anything that does not
 * start with `_`, `%` or a separator leaves after one string test.
 */
export function isInternalTenantTreePath(pathname: string): boolean {
  if (!/^[/\\]+[_%\\/]/.test(pathname)) return false
  let path = pathname
  for (let i = 0; i < 3 && path.includes('%'); i += 1) {
    // Decode each segment alone, so one malformed escape later in the path cannot
    // hide the first segment.
    path = path
      .split('/')
      .map((part) => {
        try {
          return decodeURIComponent(part)
        } catch {
          return part
        }
      })
      .join('/')
  }
  const first = path.replace(/^[/\\]+/, '').split(/[/\\]/, 1)[0]
  return first.toLowerCase() === '_t'
}

/** The extensions proxy.ts's matcher treats as static files, anchored to the end of the path. */
const STATIC_FILE = /\.(?:html?|css|js|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|wasm)$/i

let routedSegments: ReadonlySet<string> | null = null

/**
 * The first URL segment of every manifest route, lower case. A dotted URL under
 * one of these is a route that would otherwise render a page, not a static file.
 * The bypass entries are real files as far as a tenant host is concerned.
 */
function firstRouteSegments(): ReadonlySet<string> {
  if (routedSegments) return routedSegments
  const out = new Set<string>()
  for (const file of Object.keys(ROUTE_MANIFEST)) {
    if (tenantSurfaceDecision(file) === 'bypass') continue
    const segments = file
      .replace(/^app\//, '')
      .split('/')
      .slice(0, -1)
      .filter((part) => !/^\(.+\)$/.test(part))
    if (segments[0]) out.add(segments[0].toLowerCase())
  }
  routedSegments = out
  return out
}

/** A URL that can only be a file under public/ or a bypass entry: never a page or an API. */
function isStaticFileOnTenantHost(pathname: string): boolean {
  if (!STATIC_FILE.test(pathname) || /[%\\?#]/.test(pathname)) return false
  const segments = pathname.split('/').slice(1)
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return false
  return !firstRouteSegments().has(segments[0].toLowerCase())
}

/** How the proxy answers a path on a tenant host. */
export type TenantHostRoute =
  /** `/`: the tenant tree's own home page. */
  | 'home'
  /** `/robots.txt`: answer TENANT_HOST_ROBOTS_TXT. */
  | 'robots'
  /** An allowed page: rewrite into the tenant tree. */
  | 'page'
  /** An allowed API: forward with the trusted tenant headers. */
  | 'api'
  /** A file under public/: pass through, no session and no tenant headers. */
  | 'static'
  /** Everything else: 404. */
  | 'denied'

/**
 * The tenant-host routing decision for a raw pathname. Deny by default.
 *
 * `/` is not on the allow-list, because the manifest's `/` is Stellr's marketing
 * home. Decided in B5: on a tenant host it serves the tenant tree's own neutral
 * home page (`app/%5Ft/[tenant]/page.tsx`), whose body holds no Stellr content and
 * no tenant data, so a visitor who trims a link to the bare host gets a real answer
 * and a pointer back to their link, and an active host is told apart from an
 * unknown one (404). A later slice may replace that page with a tenant's event list.
 * The root layout still wraps the tree, with Stellr's metadata and trackers, until
 * B5c gives the tree its own.
 */
export function tenantHostRoute(pathname: string): TenantHostRoute {
  if (pathname === '/') return 'home'
  if (pathname === '/robots.txt') return 'robots'
  if (isInternalTenantTreePath(pathname)) return 'denied'
  if (isAllowedOnTenantHost(pathname)) return pathname.startsWith('/api/') ? 'api' : 'page'
  return isStaticFileOnTenantHost(pathname) ? 'static' : 'denied'
}

/**
 * Whether a tenant host may serve this pathname. Deny by default: only the
 * URLs of allowed manifest files pass. A pathname with a query, a fragment, a
 * dot segment, an empty segment or the internal tenant tree is refused.
 */
export function isAllowedOnTenantHost(pathname: string): boolean {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return false
  if (/[?#\\]/.test(pathname)) return false
  if (isInternalTenantTreePath(pathname)) return false
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  if (path !== '/' && path.split('/').slice(1).some((s) => s === '' || s === '.' || s === '..')) {
    return false
  }
  if (/%2e|%2f|%5c/i.test(path)) return false
  return patterns().some((re) => re.test(path))
}
