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
// Where the rule is enforced (docs/TENANCY-S4.md, "Storage"): in server code,
// not in a storage.objects policy. The app reaches Storage through the
// Storage HTTP API with the secret key, which runs as service_role and
// bypasses RLS; a browser would run as anon or authenticated. No request ever
// runs as tenant_app, so a policy TO tenant_app would never apply. S5's
// tenant upload and signing code builds every path with tenantObjectPath and
// checks every path it signs or reads with assertTenantObjectPath. Nothing
// calls these on a live flow yet.

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

/**
 * The check tenant code runs before it signs, reads, replaces or deletes an
 * object with the secret key (which no storage.objects policy can stop):
 * returns the path when it sits inside `tenantId`'s own folder, and throws
 * otherwise — a legacy path, another tenant's folder, or a path that is not
 * literal. Stellr's existing upload code keeps its own legacy paths and does
 * not call this.
 */
export function assertTenantObjectPath(tenantId: string, path: string): string {
  const id = assertTenantId(tenantId)
  if (typeof path !== 'string' || !isLiteralStoragePath(path)) {
    throw new Error('assertTenantObjectPath: not a literal storage path')
  }
  const slash = path.indexOf('/')
  if (slash <= 0 || path.slice(0, slash) !== id || slash === path.length - 1) {
    throw new Error("assertTenantObjectPath: the object is not in this tenant's folder")
  }
  return path
}

/** Whether `tenantId` may read the object at `path` under the ownership rule. */
export function objectVisibleToTenant(path: string, tenantId: string, tenantIds: Iterable<string>): boolean {
  return objectTenantId(path, tenantIds) === assertTenantId(tenantId)
}
