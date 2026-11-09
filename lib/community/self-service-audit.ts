import type { AuditAction } from '@/lib/audit/actions'
import { auditEnabled } from '@/lib/audit/platform'
import type { AuditActor, AuditMutation, AuditTenant } from '@/lib/audit/route'

// The platform audit event for a member's own writes: app/api/members/** (except
// teams, which A8 audits) and app/api/community/** (docs/TENANCY-S5.md, B16).
//
// Each route file keeps two small helpers that call auditMutation itself, because the
// coverage gate (lib/security/audit-coverage.ts) counts only a writer called from the
// route's own file. This module decides what those helpers write:
//
//   - Nothing while PLATFORM_AUDIT_ENABLED is off: no session read, no counting, no
//     note kept. With the flag off every route answers exactly as before.
//   - Nothing for a 4xx. That is a refusal, and it wrote nothing. Anything else is
//     recorded with its status, and a handler that threw as a 500.
//   - Ids, short codes, counts and flags only. Never a name, an address, message or
//     post text, a file name, a date or anything from a health or consent form: the
//     log is append-only and cannot be purged. lib/audit/platform drops what slips
//     through, but these helpers do not hand it anything to drop.
//   - The actor is read from the session here, in the request, so it does not rest on
//     Clerk's auth() working inside after(). The write itself goes after the response.
//   - The actions that are frequent by design (HIGH_VOLUME_ACTIONS: autosave, reactions,
//     chat, progress ticks, mark-read) cannot grow the log without limit. Each signed-in
//     user gets AUDIT_ROWS_PER_WINDOW rows per action per hour on each instance. Every
//     other action a signed-in member takes is always recorded, so repeating a cheap
//     request can never push a rarer one out of the log. Every caller with no session
//     shares AUDIT_ROWS_PER_WINDOW per action, whatever the action. One more row, marked
//     `coalesced`, says the rest of the window went unrecorded, and the first row of the
//     next window carries `skipped_before`, the count that went unrecorded. This caps the
//     audit write only: every request still does what it did.
//   - Nothing here throws into a route. A failure costs the event, never the answer.

export const AUDIT_ROWS_PER_WINDOW = 120
export const AUDIT_WINDOW_MS = 60 * 60 * 1000

/** The only actions a signed-in member's rows are capped for: each is frequent by design. */
export const HIGH_VOLUME_ACTIONS: ReadonlySet<AuditAction> = new Set<AuditAction>([
  'member.survey.save',
  'community.reaction.toggle',
  'community.chat_message.create',
  'community.training.progress',
  'community.notifications.mark_read',
])
/** Bounds the counters. A dropped counter starts again, which can only let rows through. */
const MAX_COUNTERS = 5_000

/** What a route says about its own writes. */
export interface SelfServiceAudit {
  action: AuditAction
  /** The table written. The row's id, when the handler knows it, comes from noteAudit. */
  table?: string
  /**
   * Defaults to Stellr: members and community answer only on Stellr's hosts
   * (lib/tenancy/tenant-surface). self-service-audit.surface.test.ts fails if a route
   * relying on this default is allowed on a tenant host, so that move settles the chain.
   */
  tenant?: AuditTenant
}

/** What a handler learns part way through: the row it wrote, its event, a short code. */
export interface AuditNote {
  targetId?: string | null
  table?: string
  tenant?: AuditTenant
  metadata?: Record<string, string | number | boolean | null>
}

const notes = new WeakMap<Request, AuditNote>()

/**
 * Remember something about this request for its audit event. A no-op while the flag is
 * off. Call it once the value is known to be good, not from the raw body: a 4xx is never
 * recorded, but a later 5xx is.
 */
export function noteAudit(req: Request, note: AuditNote): void {
  try {
    if (!auditEnabled()) return
    const prev = notes.get(req) ?? {}
    notes.set(req, { ...prev, ...note, metadata: { ...prev.metadata, ...note.metadata } })
  } catch {
    // never fails the request
  }
}

/** An update or delete, already filtered, that can also return the ids it reached. */
export type FilteredWrite = PromiseLike<{ error: unknown }> & {
  select(columns: 'id'): PromiseLike<{ data: unknown; error: unknown }>
}

/**
 * Run an update or delete whose filter carries a caller-supplied id, and note as its
 * target only a row the write reached, with `matched` set to how many it reached. A
 * request naming an id it does not own reaches nothing and is recorded with no target.
 * While the flag is off the query runs exactly as it was built, with no returned rows.
 */
export async function writeNotingTarget(req: Request, write: FilteredWrite): Promise<{ error: unknown }> {
  if (!auditEnabled()) return { error: (await write).error }
  const { data, error } = await write.select('id')
  if (!error) {
    const rows = Array.isArray(data) ? (data as Array<{ id?: unknown }>) : []
    const first = rows[0]?.id
    noteAudit(req, { targetId: typeof first === 'string' ? first : null, metadata: { matched: rows.length } })
  }
  return { error }
}

/** The value if it is one of `ops`, else null: a caller's string never reaches the log. */
export function knownOperation<T extends string>(value: unknown, ops: readonly T[]): T | null {
  return typeof value === 'string' && (ops as readonly string[]).includes(value) ? (value as T) : null
}

interface Counter {
  count: number
  windowStart: number
  /** Rows the previous window skipped, reported on this window's first recorded row. */
  carried: number
}

export interface AuditBudget {
  verdict: 'record' | 'last' | 'skip'
  /** On the first row of a window that follows skipped rows: how many were skipped. */
  skippedBefore: number
}

// Kept apart from lib/rate-limit's buckets, so audit counting can never evict a real
// limiter's window.
const counters = new Map<string, Counter>()

function evictIfFull(now: number) {
  if (counters.size < MAX_COUNTERS) return
  for (const [key, c] of counters) if (now - c.windowStart >= AUDIT_WINDOW_MS) counters.delete(key)
  for (const key of counters.keys()) {
    if (counters.size < MAX_COUNTERS) break
    counters.delete(key)
  }
}

/**
 * Record, record the last one marked `coalesced`, or skip. Per instance. A signed-in
 * user is capped only for HIGH_VOLUME_ACTIONS; a caller with no session for every action.
 */
export function auditBudget(userId: string | null, action: AuditAction, now = Date.now()): AuditBudget {
  if (userId && !HIGH_VOLUME_ACTIONS.has(action)) return { verdict: 'record', skippedBefore: 0 }
  const key = `${userId ?? 'anonymous'}:${action}`
  let c = counters.get(key)
  if (!c || now - c.windowStart >= AUDIT_WINDOW_MS) {
    const carried = c ? Math.max(0, c.count - AUDIT_ROWS_PER_WINDOW - 1) : 0
    evictIfFull(now)
    c = { count: 0, windowStart: now, carried }
    counters.set(key, c)
  }
  c.count++
  if (c.count <= AUDIT_ROWS_PER_WINDOW) {
    const skippedBefore = c.carried
    c.carried = 0
    return { verdict: 'record', skippedBefore }
  }
  return { verdict: c.count === AUDIT_ROWS_PER_WINDOW + 1 ? 'last' : 'skip', skippedBefore: 0 }
}

/** For tests. */
export function resetAuditBudget(): void {
  counters.clear()
}

async function sessionUser(): Promise<{ ok: true; userId: string | null } | { ok: false }> {
  try {
    const { auth } = await import('@clerk/nextjs/server')
    return { ok: true, userId: (await auth()).userId ?? null }
  } catch {
    return { ok: false }
  }
}

/**
 * The event to write for this answer, or null to write none. `res` is undefined when the
 * handler threw. Never throws.
 */
export async function selfServiceEvent(req: Request, res: Response | undefined, spec: SelfServiceAudit): Promise<AuditMutation | null> {
  try {
    if (!auditEnabled()) return null
    const status = res ? res.status : 500
    if (status >= 400 && status < 500) return null

    const session = await sessionUser()
    // The deferred write tries the session again, and the row says so if it cannot name anyone.
    const actor: AuditActor = session.ok ? { userId: session.userId } : { session: true }
    const budget = auditBudget(session.ok ? session.userId : null, spec.action)
    if (budget.verdict === 'skip') return null

    const note = notes.get(req) ?? {}
    const table = note.table ?? spec.table
    return {
      action: spec.action,
      actor,
      tenant: note.tenant ?? spec.tenant ?? { stellr: true },
      target: table ? { table, id: note.targetId ?? null } : null,
      metadata: {
        ...note.metadata,
        status,
        ...(budget.verdict === 'last' ? { coalesced: true } : {}),
        ...(budget.skippedBefore > 0 ? { skipped_before: budget.skippedBefore } : {}),
      },
    }
  } catch {
    return null
  }
}
