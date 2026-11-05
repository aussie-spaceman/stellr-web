import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

/**
 * The tenant the current request is for. A stub until the routing lane's host
 * context lands: every request is Stellr's, so behaviour is unchanged. Its own
 * module so the two-tenant tests (lib/authz/two-tenant.test.ts) can mock it.
 *
 * Before this returns anything but Stellr, every caller trusting
 * requireEventAccess's isAdmin or assignedSlugs on a row loaded by global id
 * must be on loadScoped or accessCoversEvent.
 */
export function currentTenantId(): string {
  return STELLR_TENANT_ID
}
