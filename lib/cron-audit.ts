import { withAudit } from '@/lib/audit/route'
import { isProd } from './env'

// One audit event per finished cron run (docs/TENANCY-S5.md, B12). Each route is
//
//   export const GET = withCronAudit('<job>', async (req) => {
//     const blocked = guardCron(req)
//     …
//   })
//
// so the event comes from C7's wrapper and test/audit-coverage.test.ts can see it. Off
// unless PLATFORM_AUDIT_ENABLED=true. The gate accepts this wrapper in a cron route only.
//
// What it writes, on the platform chain: actor cron:<job>, action cron.run.finish, and
// the status the run answered with. A run spans tenants, so it is no one tenant's
// event. The response body is never read: motion-bookings answers with email addresses.
//
// guardCron refuses two ways, and neither records anything. A wrong secret answers 401,
// which withAudit leaves out as a refusal. Outside production it answers 200 with
// { skipped: true }, which withAudit would count as work done, so outside production the
// handler runs with no audit at all. A cron therefore writes no event on dev, even with
// the flag on: the first real row can only come from production, through a cron that
// really ran, so a green dev flip says nothing about crons.
//
// A run the platform kills at maxDuration never gets here, and the write after the
// response can be lost with its instance, so it leaves no event although it may have
// done part of its work. A missing row means the run did not finish, or its event was
// lost: cron_runs is the record of the runs that started.
//
// A separate module from lib/cron.ts because several route tests replace that module
// with a stub holding guardCron alone, and this runs as each route loads.

export function withCronAudit<Args extends unknown[], R extends Response>(job: string, handler: (...args: Args) => Promise<R> | R): (...args: Args) => Promise<R> {
  const audited = withAudit({ action: 'cron.run.finish', actor: { cron: job }, tenant: { tenantId: null } }, handler)
  return async (...args: Args) => (isProd() ? audited(...args) : handler(...args))
}
