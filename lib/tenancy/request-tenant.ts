// Which tenant a request belongs to, for code behind proxy.ts (S5, slice B5).
//
// Two sources, never mixed:
//   - A page in the tenant tree takes the tenant from its URL param, through
//     tenantFromParams(). The param is part of the render's cache key, and the
//     tree is reachable only through the proxy's rewrite.
//   - An API route cannot live in the tree, so it reads the trusted headers the
//     proxy set, through requestTenant(). These headers can be trusted only on a
//     request the proxy ran on, because that is where a client-sent copy is deleted.
//
// requestTenant() is for app/api/** only. Every API URL reaches the proxy except
// api/img and api/csp-report, whatever its params hold. A page does not have that
// guarantee, and the proxy sets no tenant header on a tree page, so there it would
// answer Stellr. test/proxy-tenant-routing.test.ts fails if any file under app/
// outside app/api, or the bypass routes, can reach a call to it.
//
// Identity helpers must not depend on it: a session is the same person on any host,
// and treating them as signed out lets a submitted email stand in for the session's.
// One deliberate exception: the registration gates (lib/registration/individual and
// group) read no session on a tenant's host, by owner decision (10 Nov 2026) until
// S7's consent grant, so the typed address stands there. That is safe only because
// those registrations link no member and write no members row (persist), and their
// hasSession is false: nothing may treat their email as the session's.
//
// proxy.ts must not import this file: it pulls in next/headers.

import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { STELLR_TENANT_ID, STELLR_TENANT_SLUG } from './constants'
import {
  TENANT_ID_HEADER,
  TENANT_ROUTING_FLAG,
  TENANT_SLUG_HEADER,
  activeTenantBySlug,
  type TenantHostEntry,
} from './host'

export type RequestTenant =
  | { kind: 'stellr'; tenantId: typeof STELLR_TENANT_ID; tenantSlug: typeof STELLR_TENANT_SLUG }
  | { kind: 'tenant'; tenantId: string; tenantSlug: string }

const STELLR: RequestTenant = { kind: 'stellr', tenantId: STELLR_TENANT_ID, tenantSlug: STELLR_TENANT_SLUG }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * The tenant of the current API request. Stellr unless the proxy marked this
 * request as a tenant host's.
 *
 * With the flag off this does not read the request at all: it costs nothing, it
 * cannot turn a static render dynamic, and it works outside a request.
 *
 * The proxy sets both headers or neither, so one without the other, or a value
 * that does not parse, means something other than the proxy wrote them. It throws,
 * because answering "Stellr" there would hand a tenant host Stellr's data.
 */
export async function requestTenant(): Promise<RequestTenant> {
  if (process.env[TENANT_ROUTING_FLAG] !== 'true') return STELLR
  const h = await headers()
  const tenantId = h.get(TENANT_ID_HEADER)
  const tenantSlug = h.get(TENANT_SLUG_HEADER)
  if (tenantId === null && tenantSlug === null) return STELLR
  if (!tenantId || !tenantSlug || !UUID.test(tenantId) || !SLUG.test(tenantSlug)) {
    throw new Error('requestTenant: the tenant headers are not the pair the proxy sets.')
  }
  return { kind: 'tenant', tenantId, tenantSlug }
}

/**
 * The tenant a tenant-tree page was rewritten to, from its URL param. Calls
 * notFound() unless the slug is an active tenant other than the platform owner:
 * Stellr is never served from this tree. If the host map cannot be loaded this
 * also answers 404, so a page never renders without a confirmed tenant.
 */
export async function tenantFromParams(
  params: { tenant: string } | Promise<{ tenant: string }>,
): Promise<TenantHostEntry> {
  const { tenant } = await params
  const entry = await activeTenantBySlug(tenant)
  if (!entry) notFound()
  return entry
}
