import { NextResponse } from 'next/server'
import { appEnv, isProd } from './env'

/**
 * Gate for every route under `app/api/cron/`. Returns a response to send back
 * when the request must not proceed, or `null` when it may.
 *
 * Two checks, in this order:
 *
 * 1. The shared secret, as before.
 * 2. The environment. Vercel runs crons against a project's *production*
 *    deployment — and a dev Vercel project's own tracked branch is a
 *    production deployment as far as that project is concerned. Without this,
 *    standing up a dev environment would silently start a second copy of all
 *    twelve crons, mailing the same real members a second time every day.
 *
 * Secret first, so an unauthenticated prober cannot learn which environment
 * it has found.
 */
export function guardCron(req: Request): NextResponse | null {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isProd()) {
    // 200, not an error status: the cron did the right thing by declining, and
    // a non-2xx would show up in Vercel as a failing job every single day.
    return NextResponse.json({ skipped: true, reason: `APP_ENV=${appEnv()}` })
  }

  return null
}
