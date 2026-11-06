import { checkRateLimit, HOUR_MS } from '@/lib/rate-limit'
import type { AuditActor } from '@/lib/audit/route'
import type { UploadPurpose } from '@/lib/uploads'

// How many audit rows a run of signed upload URLs may write. This limits the audit
// write, not the route: every signing still goes ahead. It lives outside route.ts
// because the route manifest reads a limiter call in a handler's file as the route
// being rate limited, and this route is not.
//
// Signing stores nothing and costs a caller almost nothing, but each audit row is
// permanent and takes the chain's lock. So one user's rows per purpose are capped per
// instance, with one last row marked `coalesced` to say that later signings in the
// window went unrecorded.

const AUDIT_ROWS_PER_WINDOW = 120
const AUDIT_WINDOW_MS = HOUR_MS

export function auditCoalescing(actor: AuditActor, purpose: UploadPurpose): 'record' | 'last' | 'skip' {
  if (!('userId' in actor) || !actor.userId) return 'record'
  const key = `audit:uploads-sign:${actor.userId}:${purpose}`
  if (checkRateLimit(key, { limit: AUDIT_ROWS_PER_WINDOW, windowMs: AUDIT_WINDOW_MS }).ok) return 'record'
  return checkRateLimit(`${key}:marked`, { limit: 1, windowMs: AUDIT_WINDOW_MS }).ok ? 'last' : 'skip'
}
