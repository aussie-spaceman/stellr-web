import { createHash } from 'node:crypto'
import { consentModeScript } from '@/components/analytics/ConsentMode'
import { gtmInitScript } from '@/lib/gtm'

// ── Content-Security-Policy, Report-Only (multi-tenancy plan S1) ─────────────
//
// proxy.ts sends one of two policies on every response it handles. Both are
// Content-Security-Policy-Report-Only, so a browser reports a breach to
// /api/csp-report and blocks nothing. Enforcing comes later, once the reports
// are clean on the Clerk, Stripe and Turnstile flows.
//
// 1. NONCE policy, on routes that always render per request: the (admin),
//    (member), (auth) and (flow) route groups, plus the API. proxy.ts mints a
//    fresh nonce per request and passes the policy to Next on the request
//    headers; Next reads the nonce from there and stamps it on its own
//    bootstrap scripts and chunks. Three scripts on these routes get no nonce
//    from Next, and 'strict-dynamic' doesn't cover them, because nothing
//    trusted inserts them:
//    - clerk-js, a parser-inserted <script src> Clerk renders in the HTML.
//      proxy.ts also sends the nonce as `x-nonce` (NONCE_HEADER); the four
//      Clerk layouts read it (lib/request-nonce.ts) and pass it to ClerkProvider.
//    - GTM's init, which next/script injects inline with el.textContent and no
//      nonce (the App Router gives next/script none, outside
//      beforeInteractive). Allowed by its hash (lib/gtm.ts).
//    - ConsentMode, inline in the prerendered root layout. Allowed by its hash.
//    What those load (gtm.js, the HubSpot loader's src, Turnstile, Jitsi's
//    external_api.js, Vercel Analytics, clerk-js's UI bundle) is inserted by
//    script, so 'strict-dynamic' trusts it. Inline scripts a GTM Custom HTML
//    tag injects are not covered and will report here.
//
// 2. HOST policy, everywhere else: the (public) group and Sanity Studio. Most
//    of those pages are prerendered and served from the CDN, so their HTML is
//    the same for every visitor and can't hold a per-request nonce. Making the
//    root layout read the request would render every public page per request,
//    on Hobby's metered CPU (it ran at 90% in Oct 2026). So these pages allow
//    inline script and name the script hosts instead, which still reports any
//    script from a host not listed (for example, a new tag added in GTM).
//
// Script inventory: test/inline-scripts.test.ts. Hosts below come from the
// code, except the HubSpot and Google subdomains that the HubSpot loader and
// GTM pull in themselves, taken from those vendors' published CSP lists, and
// the ad tags configured in GTM that this repo documents as live (Meta Base
// Pixel, LinkedIn Insight, Apollo.io: docs/RUNBOOK-no-ads-students.md,
// docs/GTM-TRACKING-SETUP.md). The reports will show anything missing. Stripe: the app never loads js.stripe.com;
// checkout is a top-level navigation to checkout.stripe.com, which CSP doesn't
// govern.

export const CSP_HEADER = 'Content-Security-Policy-Report-Only'
export const CSP_REPORT_PATH = '/api/csp-report'
export const CSP_REPORT_GROUP = 'csp-endpoint'
export { NONCE_HEADER } from '@/lib/csp-nonce-header'

// Route groups that always render per request (each reads the session, the
// search params, or is force-dynamic). test/csp.test.ts checks this list
// against app/(admin), app/(member), app/(auth) and app/(flow).
const NONCE_ROUTE =
  /^\/(admin|account|campaigns|community|home|join|sign-in|sign-up|check-in|register|sign|survey|team-profile|api)(\/|$)/

export function usesNonce(pathname: string): boolean {
  return NONCE_ROUTE.test(pathname)
}

function origin(value: string | undefined): string | null {
  try {
    return value ? new URL(value).origin : null
  } catch {
    return null
  }
}

/**
 * Clerk's Frontend API host, from the publishable key: `pk_live_` or `pk_test_`
 * then base64 of `<host>$`. Clerk loads clerk-js from it and calls it.
 */
export function clerkFrontendApi(publishableKey: string | undefined): string {
  const m = /^pk_(?:live|test)_(.+)$/.exec(publishableKey ?? '')
  if (m) {
    try {
      const host = Buffer.from(m[1], 'base64').toString('utf8').replace(/\$$/, '')
      if (/^[a-z0-9.-]+$/i.test(host)) return `https://${host}`
    } catch {
      // fall through
    }
  }
  return 'https://*.clerk.accounts.dev'
}

const GOOGLE_SCRIPT = [
  'https://www.googletagmanager.com',
  'https://*.googletagmanager.com',
  'https://www.googleadservices.com',
  'https://googleads.g.doubleclick.net',
  'https://www.google.com',
]
const GOOGLE_CONNECT = [
  'https://*.google-analytics.com',
  'https://*.analytics.google.com',
  'https://*.googletagmanager.com',
  'https://*.g.doubleclick.net',
  'https://www.google.com',
]
const HUBSPOT_SCRIPT = [
  'https://js.hs-scripts.com',
  'https://js.hs-analytics.net',
  'https://js.hs-banner.com',
  'https://js.hscollectedforms.net',
  'https://js.hsadspixel.net',
  'https://js.usemessages.com',
]
const HUBSPOT_CONNECT = [
  'https://*.hubspot.com',
  'https://*.hs-banner.com',
  'https://*.hscollectedforms.net',
  'https://*.hsforms.com',
  'https://*.hs-analytics.net',
]
// Ad tags added in GTM as Custom HTML or templates. Meta's fbevents.js loads
// its config from connect.facebook.net and beacons to www.facebook.com/tr;
// LinkedIn's insight.min.js beacons to px.ads.linkedin.com; Apollo's tracker
// loads from assets.apollo.io and calls its own API.
const AD_TAG_SCRIPT = ['https://connect.facebook.net', 'https://snap.licdn.com', 'https://assets.apollo.io']
const AD_TAG_CONNECT = ['https://www.facebook.com', 'https://connect.facebook.net', 'https://px.ads.linkedin.com', 'https://*.apollo.io']
const TURNSTILE = 'https://challenges.cloudflare.com'
const JITSI = ['https://8x8.vc', 'https://meet.jit.si']
// Vercel Analytics / Speed Insights are same-origin (/_vercel/…) in a
// deployment; `next dev` loads them from here.
const VERCEL_DEV_SCRIPTS = 'https://va.vercel-scripts.com'

function sha256(text: string): string {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`
}

type Env = Record<string, string | undefined>

// Built once per instance: the env, the ConsentMode text and the GTM container
// are fixed for a deployment (NEXT_PUBLIC_GTM_ID is inlined at build, in the
// proxy and in GoogleTagManager alike).
let defaultDirectives: string | undefined
let defaultGtmHash: string | null | undefined
let consentHash: string | undefined
export function consentModeHash(): string {
  return (consentHash ??= sha256(consentModeScript()))
}

/** Directives the two policies share, built once per environment. */
function shared(env: Env) {
  const supabase = origin(env.NEXT_PUBLIC_SUPABASE_URL)
  const media = origin(env.NEXT_PUBLIC_MEDIA_BASE_URL)
  const clerk = clerkFrontendApi(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
  const sanityProject = env.NEXT_PUBLIC_SANITY_PROJECT_ID
  // Sanity Studio (/studio) talks to the project API, live over a websocket.
  const sanity = sanityProject && /^[a-z0-9]+$/i.test(sanityProject)
    ? [`https://${sanityProject}.api.sanity.io`, `https://${sanityProject}.apicdn.sanity.io`, `wss://${sanityProject}.api.sanity.io`, 'https://api.sanity.io']
    : []
  const list = (xs: (string | null)[]) => xs.filter((x): x is string => !!x)

  return {
    clerk,
    directives: [
      "default-src 'self'",
      // Clerk, next/font and Sanity Studio inject styles.
      "style-src 'self' 'unsafe-inline'",
      // Sanity images, media on Vercel Blob, Clerk avatars, tracking pixels.
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      `media-src ${list(["'self'", 'blob:', media, supabase]).join(' ')}`,
      `connect-src ${list([
        "'self'",
        // Supabase: Storage uploads to signed URLs, Realtime chat over wss.
        supabase,
        supabase ? supabase.replace(/^https:/, 'wss:') : null,
        // pdf.js fetches lesson PDFs from the media host.
        media,
        clerk,
        'https://clerk-telemetry.com',
        TURNSTILE,
        ...sanity,
        ...GOOGLE_CONNECT,
        ...HUBSPOT_CONNECT,
        ...AD_TAG_CONNECT,
        VERCEL_DEV_SCRIPTS,
      ]).join(' ')}`,
      // Lesson embeds are any https URL an admin enters (YouTube, Vimeo, the
      // Google Docs viewer); Jitsi rooms; Turnstile; same-origin PDF previews.
      "frame-src 'self' https: blob:",
      // pdf.js and Clerk run workers; the check-in desk registers a service worker.
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      `report-uri ${CSP_REPORT_PATH}`,
      `report-to ${CSP_REPORT_GROUP}`,
    ],
  }
}

// The check-in desk's QR scanner compiles WebAssembly ('wasm-unsafe-eval').
// `next dev` also evals for Fast Refresh, so dev allows 'unsafe-eval' to keep
// local reports quiet.
function evalSources(env: Env): string[] {
  return env.NODE_ENV === 'development' ? ["'wasm-unsafe-eval'", "'unsafe-eval'"] : ["'wasm-unsafe-eval'"]
}

/** The hash of GTM's inline init for this container, or null with no container. */
function gtmHash(env: Env): string | null {
  // Read literally for the real env, so Next inlines it exactly as it does in
  // GoogleTagManager.
  const id = env === process.env ? process.env.NEXT_PUBLIC_GTM_ID : env.NEXT_PUBLIC_GTM_ID
  return id ? sha256(gtmInitScript(id)) : null
}

/** The policy for a route that renders per request, with this request's nonce. */
export function noncePolicy(nonce: string, env: Env = process.env): string {
  const isDefault = env === process.env
  const directives = isDefault ? (defaultDirectives ??= shared(env).directives.join('; ')) : shared(env).directives.join('; ')
  const gtm = isDefault ? (defaultGtmHash === undefined ? (defaultGtmHash = gtmHash(env)) : defaultGtmHash) : gtmHash(env)
  // https: and 'unsafe-inline' only apply in browsers too old for nonces and
  // 'strict-dynamic'; newer ones ignore both.
  const script = [
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    consentModeHash(),
    ...(gtm ? [gtm] : []),
    ...evalSources(env),
    'https:',
    "'unsafe-inline'",
  ]
  return `script-src ${script.join(' ')}; ${directives}`
}

/** The policy for a page that may be prerendered: inline allowed, hosts named. */
export function hostPolicy(env: Env = process.env): string {
  const { directives, clerk } = shared(env)
  const script = [
    "'self'",
    "'unsafe-inline'",
    ...evalSources(env),
    clerk,
    TURNSTILE,
    ...GOOGLE_SCRIPT,
    ...HUBSPOT_SCRIPT,
    ...AD_TAG_SCRIPT,
    ...JITSI,
    VERCEL_DEV_SCRIPTS,
  ]
  return [`script-src ${script.join(' ')}`, ...directives].join('; ')
}

let cachedHostPolicy: string | null = null
function hostPolicyCached(): string {
  return (cachedHostPolicy ??= hostPolicy())
}

/** 128 random bits, base64. */
export function createNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString('base64')
}

/**
 * The policy for this request. `nonce` is set only for a nonce route; proxy.ts
 * then also hands the policy to Next on the request headers.
 */
export function cspFor(pathname: string): { value: string; nonce: string | null } {
  if (!usesNonce(pathname)) return { value: hostPolicyCached(), nonce: null }
  const nonce = createNonce()
  return { value: noncePolicy(nonce), nonce }
}

/** Set the Report-Only policy and the Reporting API endpoint on a response. */
export function applyCsp(res: Response, value: string, requestUrl: string): Response {
  res.headers.set(CSP_HEADER, value)
  res.headers.set('Reporting-Endpoints', `${CSP_REPORT_GROUP}="${new URL(CSP_REPORT_PATH, requestUrl).href}"`)
  return res
}
