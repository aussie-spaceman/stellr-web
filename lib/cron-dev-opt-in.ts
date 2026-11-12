// S5 wave 7, B26a: a narrow way to let one named cron step run on the hosted dev
// deployment, so the tenant guardian consent expiry sweep can be proven there
// before anything like it reaches production.
//
// guardCron (lib/cron.ts) declines every cron outside production. CRON_NON_PROD_JOBS
// lists exceptions, comma-separated. It is read only when BOTH hold:
//
//   - NEXT_PUBLIC_APP_ENV is exactly 'dev'. Set, not defaulted: appEnv() reads an
//     unset variable as dev too, which would include every local run.
//   - VERCEL_ENV is 'production'. The dev Vercel project's tracked branch deploys
//     as Production there; a preview deployment or a local run never does.
//
// In production it is never read: guardCron returns before it gets here, and
// NEXT_PUBLIC_APP_ENV is 'prod' there anyway. Unset, nothing changes anywhere.
//
// Only the values in DEV_CRON_OPT_INS are honoured. Every other value is ignored,
// so that cron is declined exactly as before. That includes every integration
// cron (Apollo, HubSpot, campaigns, alumni upgrades, background checks, Motion),
// the per-tenant crons, and membership-expiry as a whole: its second step deletes
// self-registered minors and their logins, and never runs on dev. The route holds
// that on its own too: it declines any other membership-expiry value, and never
// runs its four-step path outside production.
//
// Scheduled calls count as well as calls made by hand. Vercel's own cron calls carry
// the real CRON_SECRET, so while the variable names a job its schedule runs too
// (vercel.json): membership-expiry at 06:00 UTC daily runs the consent sweep, and
// email-outbox drains at 00:05, 06:05, 12:05 and 18:05 UTC. A proof that ages a
// consent row and then calls the sweep by hand should do both between two 06:00 UTC
// runs, or read the scheduled run's cron_runs row as the result.
//
// A separate module from lib/cron.ts because several route tests replace that
// module with a stub holding guardCron alone (see lib/cron-audit.ts).

/** The only values CRON_NON_PROD_JOBS can switch on. */
export const DEV_CRON_OPT_INS = [
  // Drains the email outbox. Outbox rows were routed when they were queued, so
  // on dev they already go to the safelist inbox (lib/email.ts).
  'email-outbox',
  // membership-expiry's step 4 alone: the tenant guardian consent sweep. The
  // route runs only that step under this value (app/api/cron/membership-expiry).
  'membership-expiry:tenant-consent',
] as const

export type DevCronOptIn = (typeof DEV_CRON_OPT_INS)[number]

function isHostedDev(): boolean {
  return process.env.NEXT_PUBLIC_APP_ENV === 'dev' && process.env.VERCEL_ENV === 'production'
}

/** The opt-ins switched on for this deployment: always empty off the hosted dev deployment. */
export function devCronOptIns(): DevCronOptIn[] {
  if (!isHostedDev()) return []
  const asked = (process.env.CRON_NON_PROD_JOBS ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  if (!asked.length) return []
  return DEV_CRON_OPT_INS.filter((v) => asked.includes(v))
}

/** The opt-in a cron runs under on the hosted dev deployment, or null when it must decline. */
export function devCronOptInFor(job: string | null): DevCronOptIn | null {
  if (!job) return null
  return devCronOptIns().find((v) => v === job || v.startsWith(`${job}:`)) ?? null
}

/**
 * The cron a request is for, from its path (/api/cron/<job>). Null for any other
 * shape, which then declines: guardCron is given only the request.
 */
export function cronJobOf(req: Request): string | null {
  let path: string
  try {
    path = new URL(req.url).pathname
  } catch {
    return null
  }
  const m = /^\/api\/cron\/([a-z0-9-]+)$/.exec(path)
  return m ? m[1] : null
}
