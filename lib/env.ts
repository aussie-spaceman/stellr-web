/**
 * Which deployment this process is, and the domains it lives on.
 *
 * Until now nothing in the app knew what environment it was in: every
 * integration inferred it from whichever credentials happened to be present.
 * That is how three months of consent forms went out on DocuSign *demo*
 * credentials without anyone noticing — absent config read as "fine" rather
 * than as "not production".
 *
 * So the question gets one answer, here, and anything that touches a real
 * person asks it.
 *
 * ---------------------------------------------------------------------------
 * THERE ARE TWO QUESTIONS, AND THEY ARE NOT THE SAME QUESTION.
 *
 *   appEnv() / isProd()                 "which environment is this deployment?"
 *     reads NEXT_PUBLIC_APP_ENV         dev vs prod, as *we* define them
 *
 *   vercelTarget() / isProductionDeployment()
 *                                       "which Vercel deployment target is this?"
 *     reads VERCEL_ENV                  production vs preview vs local
 *
 * They diverge on exactly the case that matters. The planned dev Vercel project
 * (docs/REC-deploy-environments-2026-09-07.md §2) tracks its own `dev` branch,
 * and as far as *that project* is concerned that branch is a production
 * deployment: it will have VERCEL_ENV=production while being, in every sense we
 * care about, not production.
 *
 * Which to use:
 *
 * - Deciding whether to do something to a real member — send the mail, run the
 *   cron, charge the card — use isProd(). It is the only one that will still be
 *   right once the dev project exists. Its cost is that it has to be *set*; it
 *   defaults to 'dev', so forgetting it means a deployment goes quiet, not that
 *   it starts mailing people.
 *
 * - Deciding whether misconfiguration is a *defect* rather than a local
 *   inconvenience — "this deployment is meant to be the real one, so sandbox
 *   credentials here are a bug" — use isProductionDeployment(). Vercel sets
 *   VERCEL_ENV itself, so it cannot be forgotten, which is what you want from a
 *   check whose whole job is catching things nobody remembered to configure.
 *   See lib/env-guards.ts.
 *
 * If you are reaching for one of these and the paragraph above does not obviously
 * settle which, you want isProd().
 * ---------------------------------------------------------------------------
 */

// --- Which environment is this deployment? (NEXT_PUBLIC_APP_ENV) -------------

export type AppEnv = 'dev' | 'prod'

/**
 * Defaults to 'dev' deliberately. An unset variable must fail toward "don't
 * send it", never toward "send it to a real teacher" — a new environment that
 * nobody has finished configuring is exactly the one you least want mailing
 * people.
 */
export function appEnv(): AppEnv {
  return process.env.NEXT_PUBLIC_APP_ENV === 'prod' ? 'prod' : 'dev'
}

/**
 * Read at call time, not module load. A constant evaluated on import bakes in
 * whatever the environment looked like the instant the module was first
 * required — which is fine in a long-lived server and wrong everywhere else
 * (tests that import a route before stubbing, any runtime that injects config
 * late). A safety gate should answer for the request in front of it.
 */
export function isProd(): boolean {
  return appEnv() === 'prod'
}

/**
 * Guard for work that must only ever run against production systems — a real
 * charge, a real signature request, a real background check. Throws rather
 * than no-oping, because a caller that reaches one of these in dev has a bug
 * worth surfacing, not a step worth skipping.
 */
export function assertProd(what: string): void {
  if (!isProd()) {
    throw new Error(`${what} is production-only, but APP_ENV=${appEnv()}`)
  }
}

// --- Which Vercel deployment target is this? (VERCEL_ENV) --------------------

export type VercelTarget = 'production' | 'preview' | 'development'

/**
 * Vercel's own answer, set by the platform on every deployment. Unset off
 * Vercel, which is reported as 'development' — local dev is a development
 * target, and there is nothing else it could sensibly be.
 *
 * This is a *target*, not an environment: see the header. Use appEnv() to
 * decide what a deployment is allowed to do to real people.
 */
export function vercelTarget(): VercelTarget {
  return process.env.VERCEL_ENV === 'production'
    ? 'production'
    : process.env.VERCEL_ENV === 'preview'
      ? 'preview'
      : 'development'
}

/**
 * True only on a Vercel Production deployment (not preview, not local dev).
 *
 * Correct for "should this deployment be holding live credentials?" — it is
 * platform-set and so cannot be forgotten. NOT correct for gating real-world
 * side effects: the future dev project's own branch reports true here. Use
 * isProd() for that.
 */
export function isProductionDeployment(): boolean {
  return vercelTarget() === 'production'
}

// --- Where does this deployment live? ----------------------------------------

/**
 * Public site origin (www). Falls back to production so an unset variable
 * cannot change how the live site behaves — the risk being corrected here is
 * dev pointing at prod, not prod pointing at nothing.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

/** Member app origin. Same fallback reasoning as SITE_URL. */
export const AUTH_APP_URL =
  process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

/**
 * Host of the member app, for matching an incoming request's `host` header.
 * Derived so a deployment configures one URL rather than a URL and a bare host
 * that can drift apart.
 */
export const APP_HOST = new URL(AUTH_APP_URL).host
