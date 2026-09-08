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
 */

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
