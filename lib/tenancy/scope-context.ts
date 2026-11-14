// ScopeContext (multi-tenancy plan S5): who is asking, and which slice of the
// data they may see. lib/tenancy/load-scoped.ts reads it; lib/authz.ts (the
// S5 authz lane) will produce it from the request.
//
// lib/authz.ts requireEventCrew builds one per request for a tenant_crew route,
// from the tenant its answer holds in.
//
//   tenantId    the tenant whose rows the caller may reach (a tenant uuid)
//   eventSlugs  null = every event in the tenant. An array = only these
//               events (an event manager's assignments). An empty array
//               reaches no event at all: it is never widened to "all"
//   actor       who is asking, for audit and the shadow-mode log. It can only
//               refuse, never widen: the filters come from tenantId and
//               eventSlugs, and planScope refuses the platform audit and admin
//               tables to anyone but a platform_admin or system actor
//
// Only makeScope and stellrScope produce a scope the tenancy code accepts. An
// object literal of the same shape is refused (assertMadeScope), so no route
// can skip the checks here. Scopes are built and read inside one request, so a
// module-private WeakSet is enough; a second copy of this module fails closed.
//
// Dependency-free apart from the tenancy constants, so tests and scripts can
// import it without a database client.

import { STELLR_TENANT_ID } from './constants'
import { assertTenantId, TenantContextError } from './tenant-id'

/** The kinds of caller a scope is built for. */
export type ScopeActorKind = 'platform_admin' | 'tenant_admin' | 'crew' | 'event_manager' | 'system'

export const SCOPE_ACTOR_KINDS: readonly ScopeActorKind[] = [
  'platform_admin',
  'tenant_admin',
  'crew',
  'event_manager',
  'system',
]

/** Same character set as a route's slug key. Quotes and commas would change a PostgREST in() list. */
const EVENT_SLUG = /^[A-Za-z0-9._:-]{1,200}$/

const MADE_SCOPES = new WeakSet<object>()

export interface ScopeActor {
  kind: ScopeActorKind
  /** members.id of the caller, when there is one (null for crons and webhooks). */
  memberId: string | null
}

export interface ScopeContext {
  readonly tenantId: string
  readonly eventSlugs: readonly string[] | null
  readonly actor: ScopeActor
}

/**
 * A validated, frozen ScopeContext. Throws TenantContextError on a missing or
 * malformed tenant id, an unknown actor kind, or an event list holding
 * anything but slugs. The list is required: null says "every event" out loud,
 * and undefined (a lookup that failed, say) is refused rather than read as
 * null. An event manager must name their events: null is not what the role
 * grants.
 */
export function makeScope(input: {
  tenantId: unknown
  eventSlugs: readonly unknown[] | null
  actor: { kind: unknown; memberId?: unknown }
}): ScopeContext {
  const tenantId = assertTenantId(input.tenantId)
  const kind = input.actor?.kind
  if (typeof kind !== 'string' || !SCOPE_ACTOR_KINDS.includes(kind as ScopeActorKind)) {
    throw new TenantContextError('scope needs a known actor kind')
  }
  const memberId = input.actor.memberId ?? null
  if (memberId !== null && (typeof memberId !== 'string' || memberId.trim() === '')) {
    throw new TenantContextError('scope actor memberId must be a non-empty string or null')
  }
  const raw = input.eventSlugs
  if (raw === undefined) throw new TenantContextError('scope eventSlugs must be listed, or null for every event')
  let eventSlugs: readonly string[] | null = null
  if (raw !== null) {
    if (!Array.isArray(raw)) throw new TenantContextError('scope eventSlugs must be an array or null')
    for (const s of raw) {
      if (typeof s !== 'string' || !EVENT_SLUG.test(s)) throw new TenantContextError('scope eventSlugs must be event slugs')
    }
    eventSlugs = Object.freeze([...new Set(raw as string[])])
  }
  if (kind === 'event_manager' && eventSlugs === null) {
    throw new TenantContextError('an event_manager scope must list its events')
  }
  const scope: ScopeContext = Object.freeze({
    tenantId,
    eventSlugs,
    actor: Object.freeze({ kind: kind as ScopeActorKind, memberId: memberId as string | null }),
  })
  MADE_SCOPES.add(scope)
  return scope
}

/** Throws TenantContextError unless `scope` came from makeScope or stellrScope. */
export function assertMadeScope(scope: ScopeContext): void {
  if (!scope || typeof scope !== 'object' || !MADE_SCOPES.has(scope)) {
    throw new TenantContextError('scope must come from makeScope or stellrScope')
  }
}

/** Stellr's scope: tenant #1. `eventSlugs` narrows it; null means every event. */
export function stellrScope(actor: ScopeActor, eventSlugs: readonly string[] | null): ScopeContext {
  return makeScope({ tenantId: STELLR_TENANT_ID, eventSlugs, actor })
}

/**
 * Every event in a tenant. For a route that has made its own event check: an event
 * manager passes `crew` here, because the event_manager kind must name its events.
 */
export function tenantWideScope(tenantId: unknown, kind: 'tenant_admin' | 'crew'): ScopeContext {
  return makeScope({ tenantId, eventSlugs: null, actor: { kind, memberId: null } })
}

/** True when the scope is Stellr's (the platform owner, tenant #1). */
export function isStellrScope(scope: Pick<ScopeContext, 'tenantId'>): boolean {
  return scope.tenantId === STELLR_TENANT_ID
}

/** True when the scope is narrowed to a list of events. */
export function isEventScoped(scope: Pick<ScopeContext, 'eventSlugs'>): boolean {
  return scope.eventSlugs !== null
}
