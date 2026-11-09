// What each access class must call, for the AST guard check in
// test/route-manifest.test.ts (S2). The manifest itself is route-manifest.ts;
// how to use both is docs/SECURITY-route-manifest.md.
//
// A handler satisfies a guard KIND when it calls (directly, or through a helper
// declared in the same file) either a BASE idiom or a DELEGATE: a shared helper
// in lib/ that the test analyses too, to prove it reaches a base idiom of that
// kind. Adding a new guard helper therefore means listing it here, which is a
// visible, reviewed step, and the test checks the claim.
import type { RouteClass } from './route-manifest'
import { ASYNC_LIMITER_ORIGIN, CHECKED_USE_ORIGIN, fileModule, type CallUse, type HandlerFacts } from './route-ast'

export type GuardKind = 'session' | 'admin' | 'tenant' | 'platform' | 'webhook' | 'cron' | 'rate_limit'

/** The facts satisfies() reads (a HandlerFacts, or a slice of one). */
export type CallFacts = Pick<HandlerFacts, 'calls' | 'origins' | 'comparesRoleToAdmin' | 'uses'>

const CLERK = '@clerk/nextjs/server'
const AUTHZ = CHECKED_USE_ORIGIN
const AUTHZ_DECIDE = 'lib/authz/decide'
/** requireEventAccess called with an event named, as enforcedFacts() records it. */
const EVENT_NAMED = 'requireEventAccess#slug'

/**
 * Calls that ARE the check, each with the origins it is accepted from (see
 * lib/security/route-ast.ts). A bare call's origin is the module it was
 * imported from (`auth as clerkAuth` is resolved to auth); a method call's is
 * its receiver's root, so `wh.verify()` counts only when `wh` is a svix
 * `new Webhook(…)`, and `stripe.webhooks.constructEvent()` only when `stripe`
 * comes from lib/stripe. A library's own export called inside that library
 * has the library as its origin.
 */
export const BASE_GUARDS: Record<GuardKind, Record<string, readonly string[]>> = {
  session: { auth: [CLERK], currentUser: [CLERK] },
  // Predicates over the Clerk session claims. An inline `role === 'admin'`
  // comparison also counts, but only when the role is read from the session
  // claims AND Clerk's auth()/currentUser() is called (see baseKinds()).
  admin: { isAdminClaims: ['lib/admin-auth'], hasAdminPortalAccess: ['lib/admin-auth'] },
  // The lib/authz primitives. The platform check also gives `admin`, and both give
  // `session` (see withImplied()). A legacy admin check never gives `tenant` or
  // `platform`. A lib/authz call counts only when its answer is used (enforcedFacts()).
  tenant: { assertTenantRole: [AUTHZ] },
  platform: { assertPlatformAdmin: [AUTHZ] },
  // Signature or shared-secret verification: library verifiers, node's
  // timingSafeEqual, and the repo's provider-specific verifiers.
  webhook: {
    verify: ['svix'],
    constructEvent: ['stripe', 'lib/stripe'],
    parseBody: ['next-sanity/webhook'],
    timingSafeEqual: ['crypto', 'node:crypto'],
    safeStrEqual: ['lib/secret-compare'],
    verifyConnectHmac: ['lib/docusign'],
    verifyWebhook: ['lib/background-provider'],
    verifyPrintfulWebhook: ['lib/store/printful'],
  },
  cron: { guardCron: ['lib/cron'] },
  rate_limit: { checkRateLimit: ['lib/rate-limit'] },
}

/**
 * Shared helpers trusted as a guard of the listed kinds. The test reads each
 * one from `file` and fails unless it reaches a base idiom (or another
 * delegate) of every kind listed. A handler's call counts only when the helper
 * is imported from `file`. An admin helper also authenticates, so it
 * satisfies `session` as well (see satisfies() below).
 *
 * The key is the name a handler calls, unless `call` gives it (two helpers share
 * a name while the legacy one lives). `export` is where the test finds the helper
 * when it is not a top-level export of that name: `page.requireAdmin` is a method
 * of the exported `page`. A handler's `authz.page.requireAdmin()` is recorded as
 * requireAdmin, from lib/authz.
 */
export const DELEGATE_GUARDS: Record<string, { file: string; kinds: GuardKind[]; call?: string; export?: string }> = {
  // session
  getCurrentMember: { file: 'lib/community.ts', kinds: ['session'] },
  getSignedInMember: { file: 'lib/community.ts', kinds: ['session'] },
  // Where those two do their work (B8). A route may import from either file.
  'getCurrentMember@member-session': { file: 'lib/member-session.ts', kinds: ['session'], call: 'getCurrentMember' },
  'getSignedInMember@member-session': { file: 'lib/member-session.ts', kinds: ['session'], call: 'getSignedInMember' },
  getOnboardedMember: { file: 'lib/onboarded-member.ts', kinds: ['session'] },
  currentStoreMember: { file: 'lib/store/auth.ts', kinds: ['session'] },
  resolveRequestMember: { file: 'lib/impersonation.ts', kinds: ['session'] },
  currentMemberId: { file: 'lib/impersonation.ts', kinds: ['session'] },
  signedInMemberForConsent: { file: 'lib/pending-consent.ts', kinds: ['session'] },
  getMemberCampaignContext: { file: 'lib/campaign-registrations.ts', kinds: ['session'] },
  getRegistrationPrefill: { file: 'lib/registration-prefill.ts', kinds: ['session'] },
  // The survey API shared by the token and member routes: rate-limits, then
  // resolves the invitation from the token or the signed-in member.
  resolveSession: { file: 'lib/survey/http.ts', kinds: ['session', 'rate_limit'] },
  handleOpen: { file: 'lib/survey/handlers.ts', kinds: ['session', 'rate_limit'] },
  handleSave: { file: 'lib/survey/handlers.ts', kinds: ['session', 'rate_limit'] },
  handleSubmit: { file: 'lib/survey/handlers.ts', kinds: ['session', 'rate_limit'] },
  // admin
  requireAdminPage: { file: 'lib/admin-auth.ts', kinds: ['admin'] },
  currentUserIsAdmin: { file: 'lib/admin-auth.ts', kinds: ['admin'] },
  currentUserHasScope: { file: 'lib/admin-auth.ts', kinds: ['admin'] },
  requireEventAccess: { file: 'lib/event-access.ts', kinds: ['admin'] },
  requireScholarshipAdmin: { file: 'lib/scholarship-admin.ts', kinds: ['admin'] },
  requireSurveyAdmin: { file: 'lib/survey/admin-auth.ts', kinds: ['admin'] },
  canManageStoreCatalog: { file: 'lib/store/auth.ts', kinds: ['admin'] },
  // The agreement-template editor routes' shared guard (returns null for a non-admin).
  adminName: { file: 'app/api/admin/esign/templates/guard.ts', kinds: ['admin'] },
  // lib/authz composites. requireStellrAdmin answers for Stellr only and the
  // portal check lets an event manager in, so neither is a `tenant` check.
  // isStaffTarget (about someone else) and accessCoversEvent (about a row) do not
  // decide whether the caller gets in, so they are deliberately not listed.
  getPrincipal: { file: 'lib/authz.ts', kinds: ['session'] },
  requireStellrAdmin: { file: 'lib/authz.ts', kinds: ['admin'] },
  isStellrAdmin: { file: 'lib/authz.ts', kinds: ['admin'] },
  hasPortalAccess: { file: 'lib/authz.ts', kinds: ['admin'] },
  hasScope: { file: 'lib/authz.ts', kinds: ['admin'] },
  requireTenantStaff: { file: 'lib/authz.ts', kinds: ['tenant'] },
  // Same name as the lib/event-access helper above, which C25 deletes. Codemod T5
  // re-points routes that stay stellr_only, so it is an admin check like the legacy
  // one. It is a `tenant` check only when it names the event: only then does the
  // answer hold in the event's own tenant and confine an event manager. Without a
  // slug it passes an event manager with any or no assignment (decide.ts), so a route
  // moving to tenant_staff passes a slug, or also calls requireTenantStaff.
  'requireEventAccess@authz': { file: 'lib/authz.ts', kinds: ['admin'], call: 'requireEventAccess' },
  'requireEventAccess@authz#slug': { file: 'lib/authz.ts', kinds: ['tenant'], call: EVENT_NAMED, export: 'requireEventAccess' },
  // For a route that names a record, not an event: its answer carries the event check for
  // that record (`covers`). This list cannot see the check being made, as it cannot for
  // requireTenantStaff, so the stellr_event_manager persona is what proves each route.
  requireEventStaff: { file: 'lib/authz.ts', kinds: ['tenant'] },
  // For a route under events/[slug]: requireEventStaff, the event check for that slug, and
  // the event's own tenant. test/events-admin-paperwork-c17.test.ts holds its answers.
  requireEventRoute: { file: 'lib/authz.ts', kinds: ['tenant'] },
  // lib/authz page adapters. page.requireStellrAdmin and the api.* adapters are
  // recorded under the composite's own name, listed above. requireAdmin stays while
  // codemod T4 needs it; scripts/authz-idioms.mjs keeps it out of "converged".
  requireAdmin: { file: 'lib/authz.ts', kinds: ['admin'], export: 'page.requireAdmin' },
  requireTenantAdmin: { file: 'lib/authz.ts', kinds: ['tenant'], export: 'page.requireTenantAdmin' },
  requireEventSection: { file: 'lib/authz.ts', kinds: ['admin'], export: 'page.requireEventSection' },
  // rate limit
  rateLimitGuard: { file: 'lib/rate-limit.ts', kinds: ['rate_limit'] },
  throttle: { file: 'lib/esign/native/http.ts', kinds: ['rate_limit'] },
  // The async limiter. Every RATE_LIMIT_STORE mode counts through checkRateLimit
  // first, which is what the test proves. `limit` is also a method on every Supabase
  // query, and only a call traced to this file counts, so `.limit(8)` is no guard. A
  // call counts only when its answer is awaited and used, through any same-file helper
  // (enforcedFacts()). test/rate-limit-await.test.ts refuses the shapes that read the
  // answer wrongly, as a truthy value or un-awaited. Neither proves that the 429 is what
  // the caller gets (`console.log(d.ok)` is a use), so a route adopting this tests for a
  // real 429.
  limit: { file: 'lib/rate-limit-async.ts', kinds: ['rate_limit'] },
  rateLimit: { file: 'lib/rate-limit-async.ts', kinds: ['rate_limit'] },
}

/**
 * The pure decisions that make a lib/authz check what it claims to be. Used only
 * to prove the primitives and composites above: they decide through these, not
 * through each other. A handler calling one gets nothing (it could pass in any
 * principal), so these are not BASE_GUARDS.
 */
export const AUTHZ_DECISIONS: Partial<Record<GuardKind, Record<string, readonly string[]>>> = {
  admin: {
    decideStellrAdmin: [AUTHZ_DECIDE],
    decidePortalAccess: [AUTHZ_DECIDE],
    decideScope: [AUTHZ_DECIDE],
    decideEventAccess: [AUTHZ_DECIDE],
  },
  tenant: {
    decideTenantRole: [AUTHZ_DECIDE],
    decideTenantStaff: [AUTHZ_DECIDE],
    decideEventAccess: [AUTHZ_DECIDE],
  },
  platform: { decidePlatformAdmin: [AUTHZ_DECIDE] },
}

/** Which guard kinds a class's handlers must reach. */
export const CLASS_REQUIREMENTS: Record<RouteClass, { kinds: GuardKind[]; firstStatement?: GuardKind }> = {
  platform_admin: { kinds: ['platform'] },
  // The stellr_only requirement, deliberately: the class moved and the guard did not
  // (C15). platform_admin above stays as strict as it was.
  platform_destined: { kinds: ['admin'] },
  tenant_staff: { kinds: ['tenant'] },
  stellr_only: { kinds: ['admin'] },
  participant: { kinds: ['session'] },
  webhook: { kinds: ['webhook'] },
  cron: { kinds: ['cron'], firstStatement: 'cron' },
  public: { kinds: ['rate_limit'] },
}

/** The facts reach `name`, called from one of the `allowed` origins. */
export function calledFrom(f: Pick<CallFacts, 'calls' | 'origins'>, name: string, allowed: readonly string[]): boolean {
  if (!f.calls.has(name)) return false
  const got = f.origins.get(name)
  return !!got && allowed.some((o) => got.has(o))
}

/** The facts call Clerk's own auth() or currentUser(). */
export function callsClerkSession(f: Pick<CallFacts, 'calls' | 'origins'>): boolean {
  return calledFrom(f, 'auth', [CLERK]) || calledFrom(f, 'currentUser', [CLERK])
}

/**
 * A platform check is an admin check (decide.ts: every platform admin is a Stellr
 * admin), and an admin or tenant check cannot pass without a signed-in user. Never
 * the other way round. A tenant check is NOT an admin check: holding a role in some
 * tenant does not make anyone a Stellr admin, so it never meets stellr_only.
 */
export function withImplied(kinds: Set<GuardKind>): Set<GuardKind> {
  if (kinds.has('platform')) kinds.add('admin')
  if (kinds.has('admin') || kinds.has('tenant')) kinds.add('session')
  return kinds
}

/** Exist only on lib/authz's `page`: they redirect or 404 themselves, and return nothing. */
const AUTHZ_PAGE_ONLY = new Set(['requireAdmin', 'requireTenantAdmin', 'requireEventSection'])
/** lib/authz checks whose first argument is the tenant being asked about. */
const AUTHZ_TENANT_ARG = new Set(['assertTenantRole', 'requireTenantStaff'])

/**
 * Does this lib/authz call decide anything? Every lib/authz check except the page
 * adapters returns its answer and never throws, so one has to be awaited and acted
 * on. And a tenant check on a tenant the request names proves only that the caller
 * belongs to the tenant they chose.
 *
 * What this cannot see: whether the tenant asked about is the tenant of the row the
 * handler then touches, a tenant that reaches a same-file helper as a parameter, and
 * a same-file helper that is itself never awaited. The tenant personas in the IDOR
 * suite (C6) are what test the first two; so none of this alone is enough to move a
 * route to tenant_staff.
 */
function enforces(name: string, use: CallUse): boolean {
  if (!use.awaited) return false
  if (use.receiver === 'page' || AUTHZ_PAGE_ONLY.has(name)) return true
  if (!use.consumed) return false
  return !(AUTHZ_TENANT_ARG.has(name) && use.firstArg === 'request')
}

/**
 * The facts with every lib/authz or async limiter call that decides nothing taken
 * out, and the per-event form of requireEventAccess told apart from the section-level
 * one. Legacy guards and the sync limiter are left alone: their results must not change.
 */
export function enforcedFacts<T extends CallFacts>(f: T): T {
  const calls = new Set(f.calls)
  const origins = new Map(f.origins)
  const uses = new Map(f.uses)
  for (const name of f.calls) {
    const from = f.origins.get(name)
    const checked = from?.has(AUTHZ) ? AUTHZ : from?.has(ASYNC_LIMITER_ORIGIN) ? ASYNC_LIMITER_ORIGIN : null
    if (!from || !checked) continue
    const decides = (u: CallUse) => (checked === AUTHZ ? enforces(name, u) : u.awaited && u.consumed)
    const good = (f.uses.get(name) ?? []).filter(decides)
    if (good.length === 0) {
      const rest = new Set(from)
      rest.delete(checked)
      if (rest.size > 0) {
        origins.set(name, rest)
      } else {
        origins.delete(name)
        calls.delete(name)
      }
    } else if (name === 'requireEventAccess') {
      const named = good.filter((u) => u.firstArg === 'value' || u.firstArg === 'request')
      if (named.length > 0) {
        calls.add(EVENT_NAMED)
        origins.set(EVENT_NAMED, new Set([AUTHZ]))
        uses.set(EVENT_NAMED, named)
      }
    }
  }
  return { ...f, calls, origins, uses }
}

/** The kinds the base idioms alone give (no delegates). An admin check implies a session. */
export function baseKinds(f: CallFacts): Set<GuardKind> {
  const out = new Set<GuardKind>()
  for (const [kind, guards] of Object.entries(BASE_GUARDS) as [GuardKind, Record<string, readonly string[]>][]) {
    if (Object.entries(guards).some(([name, from]) => calledFrom(f, name, from))) out.add(kind)
  }
  // The inline check counts only for a role read from the session claims
  // (route-ast.ts), in code that also calls Clerk. A role read from a request
  // body or a database row never counts.
  if (f.comparesRoleToAdmin && callsClerkSession(f)) out.add('admin')
  return withImplied(out)
}

/** The kinds the lib/authz decisions alone give. For proving lib/authz helpers only: see AUTHZ_DECISIONS. */
export function decisionKinds(f: Pick<CallFacts, 'calls' | 'origins'>): Set<GuardKind> {
  const out = new Set<GuardKind>()
  for (const [kind, guards] of Object.entries(AUTHZ_DECISIONS) as [GuardKind, Record<string, readonly string[]>][]) {
    if (Object.entries(guards).some(([name, from]) => calledFrom(f, name, from))) out.add(kind)
  }
  return out
}

/** The facts call the listed delegate, imported from its own file. */
export function callsDelegate(f: Pick<CallFacts, 'calls' | 'origins'>, key: string): boolean {
  const d = DELEGATE_GUARDS[key]
  return !!d && calledFrom(f, d.call ?? key, [fileModule(d.file)])
}

/**
 * The kinds a set of calls satisfies, given the delegates' (verified) kinds.
 * An admin check implies a session: it cannot pass without a signed-in user.
 */
export function satisfies(f: CallFacts): Set<GuardKind> {
  const enforced = enforcedFacts(f)
  const out = baseKinds(enforced)
  for (const [key, { kinds }] of Object.entries(DELEGATE_GUARDS)) {
    if (callsDelegate(enforced, key)) for (const k of kinds) out.add(k)
  }
  return withImplied(out)
}

/**
 * Database clients. A public metadata route (a share card, an icon, the
 * sitemap) that reaches one of these must be listed in PUBLIC_DATA_GATES.
 */
export const DATA_READERS: Record<string, readonly string[]> = {
  supabaseServer: ['lib/supabase'],
  supabaseServerTyped: ['lib/supabase'],
  supabase: ['lib/supabase'],
  createClient: ['@supabase/supabase-js'],
}

/**
 * Public metadata routes that read the database, and the checks each must
 * reach before it shows any personal data. Keyed `<file>#default`. The test
 * fails when such a route is not listed here, or no longer reaches a listed
 * call or comparison (`prop=literal`, as route-ast.ts records it).
 */
export const PUBLIC_DATA_GATES: Record<
  string,
  { calls: Record<string, readonly string[]>; compares: readonly string[]; why: string }
> = {
  'app/(stellr)/(public)/credentials/[number]/opengraph-image.tsx#default': {
    calls: { ageBlock: ['lib/credentials-core'], credentialState: ['lib/credentials-core'] },
    compares: ['visibility=public'],
    why:
      'the share card names the holder, who may be a minor: only a public credential that is not withdrawn, ' +
      'of a holder not under 13 or of unknown age (ogCardFor, deep review MP-4)',
  },
}

/**
 * Handlers that are exempt from their class's requirement, keyed
 * `<file>#<METHOD>` (or `<file>#default` for a page). Each one says why, and
 * what protects it instead. test/route-manifest.test.ts pins the COUNT, so an
 * entry cannot be added without the count changing in the same diff, and fails
 * on an entry whose handler no longer exists or no longer needs it.
 */
export const GUARD_EXCEPTIONS: Record<string, string> = {
  // ── webhook ─────────────────────────────────────────────────────────────
  'app/api/webhooks/background/route.ts#GET':
    'liveness probe for the provider dashboard; returns {ok:true} and reads nothing',
  'app/api/webhooks/docusign/route.ts#GET':
    'liveness probe for DocuSign Connect; returns {ok:true} and reads nothing',
  'app/api/webhooks/google-sheets/route.ts#POST':
    'Google push channels carry no signature; acts only on a channel id it registered (sheet_watch_channels), unexpired',

  // ── platform_destined ───────────────────────────────────────────────────
  'app/api/admin/impersonation/route.ts#DELETE':
    'ends view-as: clearing the cookie can only reduce access; the end is logged against the signed ticket',

  // ── participant ─────────────────────────────────────────────────────────
  'app/(stellr)/(member)/community/training/[moduleId]/[itemId]/page.tsx#default':
    'legacy link stub: redirects to the course page, which reads the session itself; renders no data',

  // ── stellr_only ─────────────────────────────────────────────────────────
  'app/(stellr)/studio/[[...tool]]/page.tsx#default':
    'embedded Sanity Studio; the editor authenticates against Sanity, not Clerk, and the page holds no Stellr data',

  // ── public, not rate-limited (each reviewed in S2) ──────────────────────
  'app/(stellr)/(public)/credentials/[number]/badge/route.tsx#GET':
    'renders a badge image for a credential number; proxy.ts rate-limits /credentials/*',
  'app/api/check-in-desk/manifest/route.ts#GET':
    'static web-app manifest built from a slug matched against a strict pattern; reads nothing',
  'app/api/check-in/route.ts#DELETE':
    'clears the caller\'s own check-in cookie; reads and writes nothing server-side',
  'app/api/email/unsubscribe/route.ts#GET':
    'renders a confirm page only; the POST does the work and verifies the signed opt-out token',
  'app/api/email/unsubscribe/route.ts#POST':
    'acts only on a signed opt-out token (verifyOptOutToken) or a waitlist pair; one-click unsubscribe must not fail',
  'app/api/img/route.ts#GET':
    'Sanity image watermark proxy, CDN-cached and kept out of proxy.ts for Active CPU; serves public images only',
  'app/api/schools/search/route.ts#GET':
    'TODO(S5): add a rate limit. Returns name/city/state of active schools (public directory data), at most 8 rows',
  'app/api/store/checkout/route.ts#POST':
    'TODO(S5): add a rate limit. Guest checkout by design; prices re-derived server-side, returns only a Stripe-hosted Checkout URL',
  'app/api/uploads/sign/route.ts#POST':
    'per-purpose authorisation lives in lib/uploads.ts signUpload; the claiming route re-checks the object rule',
  'app/app.webmanifest/route.ts#GET': 'static web-app manifest',
  'app/indexnow-key.txt/route.ts#GET': 'serves the public IndexNow key file, which must be public',
  'app/llms.txt/route.ts#GET': 'static llms.txt for crawlers',
}
