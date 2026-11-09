// What lib/authz requireEventRoute answers, for a route test that mocks it. The scope is a
// real one, so the loaders in lib/tenancy/load-scoped.ts run as they do in production.
// test/events-admin-paperwork-c17.test.ts holds the real function's answers.
import { NextResponse } from 'next/server'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { tenantWideScope } from '@/lib/tenancy/scope-context'

/** A Stellr admin on this event. */
export function eventRouteFor(eventSlug: string, tenantId: string = STELLR_TENANT_ID) {
  return {
    ok: true as const,
    userId: 'user_testadmin',
    isAdmin: true,
    tenantId,
    eventSlug,
    scope: tenantWideScope(tenantId, 'tenant_admin'),
    covers: (slug: string | null | undefined) => slug === eventSlug,
  }
}

/** The refusal: 401 or 403 from the check, 404 for an event outside the scope. */
export function eventRouteRefused(status: 401 | 403 | 404) {
  return {
    ok: false as const,
    status,
    response: NextResponse.json({ error: status === 404 ? 'Not found' : 'Forbidden' }, { status }),
  }
}
