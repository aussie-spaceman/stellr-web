// Is a record named in an API request one of this host's (S5 wave 7, A10a)?
//
// A route that takes a record by number or token (a credential, a team profile link)
// reads the row, then asks recordOnHost() before anything else looks at it: before the
// ownership check, before the body is validated against it, before it is written to.
// On a mismatch the route gives the answer it already gives for a record nobody has, so
// another host's record cannot be told from a missing one.
//
// The host's tenant is requestTenant()'s, so this is for app/api/** only (see
// lib/tenancy/request-tenant.ts). With TENANT_ROUTING_ENABLED off that is Stellr without
// reading the request, so on Stellr's hosts a Stellr or NULL row passes, as today, and
// another tenant's row is refused.
//
// A NULL tenant_id is a Stellr row the backfill has not reached, as everywhere in S5. The
// row type requires the column, so a select that forgot it fails to compile; and at run
// time a missing column is undefined, which is not NULL, so that row is on no host
// rather than on Stellr's.

import { STELLR_TENANT_ID } from './constants'
import { requestTenant } from './request-tenant'

/** The tenant a row belongs to: its own, or Stellr's when the column is NULL (and only NULL). */
export function recordTenant(tenantId: string | null): string {
  return tenantId === null ? STELLR_TENANT_ID : tenantId
}

/** Does a row of this tenant belong on a host of that one? Pure, for tests and callers that already know the host. */
export function onHost(row: { tenant_id: string | null }, hostTenantId: string): boolean {
  return recordTenant(row.tenant_id) === hostTenantId
}

/**
 * Whether the row is this request's host's. False sends the route to its unknown-record
 * answer. requestTenant() throws on tenant headers the proxy did not write, and that
 * throw is left to the route, as everywhere else it is called.
 */
export async function recordOnHost(row: { tenant_id: string | null }): Promise<boolean> {
  return onHost(row, (await requestTenant()).tenantId)
}
