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
import { fileModule, type HandlerFacts } from './route-ast'

export type GuardKind = 'session' | 'admin' | 'webhook' | 'cron' | 'rate_limit'

/** The facts satisfies() reads (a HandlerFacts, or a slice of one). */
export type CallFacts = Pick<HandlerFacts, 'calls' | 'origins' | 'comparesRoleToAdmin'>

const CLERK = '@clerk/nextjs/server'

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
 */
export const DELEGATE_GUARDS: Record<string, { file: string; kinds: GuardKind[] }> = {
  // session
  getCurrentMember: { file: 'lib/community.ts', kinds: ['session'] },
  getSignedInMember: { file: 'lib/community.ts', kinds: ['session'] },
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
  // rate limit
  rateLimitGuard: { file: 'lib/rate-limit.ts', kinds: ['rate_limit'] },
  throttle: { file: 'lib/esign/native/http.ts', kinds: ['rate_limit'] },
}

/** Which guard kinds a class's handlers must reach. */
export const CLASS_REQUIREMENTS: Record<RouteClass, { kinds: GuardKind[]; firstStatement?: GuardKind }> = {
  platform_admin: { kinds: ['admin'] },
  // S5 adds a tenant-membership kind here when lib/authz.ts lands.
  tenant_staff: { kinds: ['admin'] },
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
  if (out.has('admin')) out.add('session')
  return out
}

/** The facts call the listed delegate, imported from its own file. */
export function callsDelegate(f: Pick<CallFacts, 'calls' | 'origins'>, name: string): boolean {
  const d = DELEGATE_GUARDS[name]
  return !!d && calledFrom(f, name, [fileModule(d.file)])
}

/**
 * The kinds a set of calls satisfies, given the delegates' (verified) kinds.
 * An admin check implies a session: it cannot pass without a signed-in user.
 */
export function satisfies(f: CallFacts): Set<GuardKind> {
  const out = baseKinds(f)
  for (const [name, { kinds }] of Object.entries(DELEGATE_GUARDS)) {
    if (callsDelegate(f, name)) for (const k of kinds) out.add(k)
  }
  if (out.has('admin')) out.add('session')
  return out
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
  'app/(public)/credentials/[number]/opengraph-image.tsx#default': {
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

  // ── stellr_only (API) ───────────────────────────────────────────────────
  'app/api/admin/impersonation/route.ts#DELETE':
    'ends view-as: clearing the cookie can only reduce access; the end is logged against the signed ticket',

  // ── participant ─────────────────────────────────────────────────────────
  'app/(member)/community/training/[moduleId]/[itemId]/page.tsx#default':
    'legacy link stub: redirects to the course page, which reads the session itself; renders no data',

  // ── stellr_only ─────────────────────────────────────────────────────────
  'app/studio/[[...tool]]/page.tsx#default':
    'embedded Sanity Studio; the editor authenticates against Sanity, not Clerk, and the page holds no Stellr data',

  // ── public, not rate-limited (each reviewed in S2) ──────────────────────
  'app/(public)/credentials/[number]/badge/route.tsx#GET':
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
