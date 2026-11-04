// Storage paths by tenant (multi-tenancy plan S4).
//
//   * A NEW object written for a tenant goes under `{tenant_id}/…` in its
//     bucket: tenantObjectPath(tenantId, path).
//   * Every object already in Storage stays where it is and is Stellr's by
//     policy. Nothing is moved.
//
// Legacy paths can start with a uuid of their own (`{member_id}/…` for
// teacher licences and community media, see lib/uploads.ts), so a uuid first
// segment does not make a path a tenant path: it is a tenant's only when that
// uuid is a known tenant id. objectTenantId() and the database function
// public.storage_object_tenant_id() (20261104210000) apply the same rule, and
// lib/tenancy/storage.test.ts holds them to the same cases.
//
// Nothing calls these on a live flow yet; S5 routes tenant uploads through
// tenantObjectPath and adds the storage.objects policies (docs/TENANCY-S4.md).

import { STELLR_TENANT_ID } from './constants'
import { assertTenantId } from './tenant-id'
import { isLiteralStoragePath } from '../storage-path'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * The path a new object for `tenantId` is stored at: `{tenant_id}/{path}`.
 * Throws without a valid tenant, on a path that is not a literal storage path
 * (lib/storage-path.ts), or on a path that already names a tenant prefix.
 */
export function tenantObjectPath(tenantId: string, path: string): string {
  const id = assertTenantId(tenantId)
  if (typeof path !== 'string' || !isLiteralStoragePath(path)) {
    throw new Error('tenantObjectPath: not a literal storage path')
  }
  if (UUID.test(path.split('/')[0])) {
    throw new Error('tenantObjectPath: the path already starts with an id; pass the path inside the tenant folder')
  }
  return `${id}/${path}`
}

/**
 * The tenant that owns an object path: the tenant whose id is the first
 * segment (only when it is one of `tenantIds` and an object name follows),
 * otherwise Stellr — every legacy object is Stellr's.
 */
export function objectTenantId(path: string | null | undefined, tenantIds: Iterable<string>): string {
  if (typeof path !== 'string') return STELLR_TENANT_ID
  const slash = path.indexOf('/')
  if (slash <= 0) return STELLR_TENANT_ID
  const first = path.slice(0, slash)
  if (!UUID.test(first)) return STELLR_TENANT_ID
  for (const id of tenantIds) if (id === first) return first
  return STELLR_TENANT_ID
}

/** Whether `tenantId` may read the object at `path` (the policy S5 puts on storage.objects). */
export function objectVisibleToTenant(path: string, tenantId: string, tenantIds: Iterable<string>): boolean {
  return objectTenantId(path, tenantIds) === assertTenantId(tenantId)
}
