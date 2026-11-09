// What a request acted on, for a withAudit spec (docs/TENANCY-S5.md, C7). The spec runs
// after the handler and sees only its arguments, so the handler notes here who passed the
// check and what they named. Nothing is noted when the handler stops before the check: the
// event then reads the session itself and goes on the platform chain, as resolveTenant's
// rule for a tenant it cannot name says.
import type { AuditMutation } from './route'

export interface AuditSubject {
  userId: string | null
  tenantId: string
  eventSlug?: string
  /** The record acted on. A value that is not a storable id costs the id, not the event. */
  id?: string | null
  /** Ids, counts and short codes, as platform audit metadata allows. */
  detail?: Record<string, unknown>
}

const subjects = new WeakMap<Request, AuditSubject>()

/** Note who passed the route's check. A later call adds to it. */
export function noteAuditSubject(req: Request, subject: Partial<AuditSubject>): void {
  const known = subjects.get(req)
  const merged = { ...known, ...subject } as AuditSubject
  subjects.set(req, merged)
}

/** The actor, chain, target and metadata of the event for this request. */
export function auditSubject(req: Request, table: string): Pick<AuditMutation, 'actor' | 'tenant' | 'target' | 'metadata'> {
  const s = subjects.get(req)
  return {
    actor: s ? { userId: s.userId } : { session: true },
    tenant: { tenantId: s?.tenantId ?? null },
    target: { table, id: s?.id ?? null },
    metadata: { ...(s?.eventSlug ? { event_slug: s.eventSlug } : {}), ...s?.detail },
  }
}
