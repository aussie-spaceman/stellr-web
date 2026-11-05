// Auditing a mutation from a route handler (docs/TENANCY-S5.md, C7). Two ways in,
// both of which test/audit-coverage.test.ts accepts:
//
//   withAudit(spec, handler)    the preferred one: `export const POST = withAudit(…)`.
//                               Every path out of the handler is covered by
//                               construction, so an early return cannot skip it.
//   auditMutation(input, opts)  a call in the handler's own body, for when the
//                               target is known only part way through. The gate
//                               then reads the handler's paths and refuses one
//                               that can answer success after a write without it.
//
// Rules, which hold whatever the database, Clerk or the caller's input does:
//   - Nothing here ever fails a request. Every failure is recorded and swallowed.
//   - Off unless PLATFORM_AUDIT_ENABLED=true. Off, it reads no session, makes no
//     query and schedules nothing.
//   - afterResponse adds no latency, but the write can be lost if the instance is
//     reclaimed (docs/TENANCY-S5.md, Risks). Awaiting it costs up to AUDIT_TIMEOUT_MS,
//     lookups included, and RECORD_FAILURE_TIMEOUT_MS more if the write then fails.
//   - A value that cannot be stored costs that value, not the event: a row that
//     says "someone did this" beats no row, and the CHECK would refuse the lot. A
//     lookup that fails or runs out of time is the same: the row says so.
//   - target.id is never erased, so it holds a uuid or a provider's own id and nothing
//     else (isStorableTargetId). A capability token, a credential number or a slug
//     made from someone's name goes in as the row's uuid, whatever the route's URL
//     holds. A uuid cannot be told from a uuid-shaped token: that one is the caller's
//     to get right.
//
// Clerk and the events mirror are imported on demand, so a file using this pulls in
// neither until the flag is on.
//
// Not proved yet: { session: true } reading Clerk's auth() from inside after(). The
// tests mock it. If it cannot read the session there, the row says actor_unresolved,
// so the first route to use it checks a real row on dev, or passes { userId }.
import { runAfterResponse } from '@/lib/after-response'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import type { AuditAction } from './actions'
import { audit, AUDIT_TIMEOUT_MS, auditClient, auditEnabled, recordAuditFailure, type AuditInput, type AuditOptions, type AuditResult } from './platform'

/** Who did it. */
export type AuditActor =
  /** The signed-in Clerk user of this request, read when the event is written. */
  | { session: true }
  /** A Clerk user id the handler already verified. Null means nobody is signed in. */
  | { userId: string | null }
  | { cron: string }
  | { webhook: string }
  | { system: true }

/** Whose chain the event goes on. */
export type AuditTenant =
  | { stellr: true }
  /** Already resolved. Null is the platform chain. */
  | { tenantId: string | null }
  /**
   * The tenant that owns this event, from the mirror. It awaits the database, so a
   * live path passes the tenant it already resolved. An event the mirror does not
   * hold, or a read that fails, goes on the platform chain with tenant_unresolved.
   */
  | { eventSlug: string }

export interface AuditMutation {
  action: AuditAction
  actor: AuditActor
  tenant: AuditTenant
  target?: AuditInput['target']
  reason?: string | null
  metadata?: Record<string, unknown> | null
}

export interface AuditMutationOptions extends Pick<AuditOptions, 'db' | 'enabled' | 'timeoutMs'> {
  /** Write once the response has gone (live paths). The call then resolves at once. */
  afterResponse?: boolean
}

export type AuditMutationResult = AuditResult | { ok: false; skipped: 'deferred' }

// The shapes the table's actor CHECK accepts.
const CRON_JOB = /^[a-z0-9][a-z0-9._-]{0,62}$/
const WEBHOOK_PROVIDER = /^[a-z0-9_-]{1,32}$/
const CLERK_USER = /^user_[A-Za-z0-9]{1,64}$/

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Ids a provider issues, by prefix: Clerk's users and organisations, Stripe's objects. */
const PROVIDER_ID = /^(?:user|org|cs|pi|ch|re|in|evt|cus|sub)_[A-Za-z0-9_]{1,128}$/

/**
 * Narrower than the table's CHECK, which only keeps out `@` and whitespace: a date of
 * birth, a phone number, a name, a credential number and a token all fit that, and the
 * row can never be erased. A route with some other kind of id adds its shape here.
 */
export function isStorableTargetId(id: string): boolean {
  return UUID.test(id) || PROVIDER_ID.test(id)
}

interface Resolved {
  actor: string
  metadata: Record<string, unknown>
}

interface ResolvedTenant {
  tenantId: string | null
  metadata: Record<string, unknown>
}

const SYSTEM_UNRESOLVED: Resolved = { actor: 'system', metadata: { actor_unresolved: true } }
const TENANT_UNRESOLVED: ResolvedTenant = { tenantId: null, metadata: { tenant_unresolved: true } }

function userActor(userId: string | null | undefined): Resolved {
  if (!userId) return { actor: 'system', metadata: { actor_anonymous: true } }
  return CLERK_USER.test(userId) ? { actor: userId, metadata: {} } : SYSTEM_UNRESOLVED
}

/** The stored actor for an event, and what the row should say if it could not be named. */
export async function resolveActor(a: AuditActor): Promise<Resolved> {
  try {
    if ('system' in a) return { actor: 'system', metadata: {} }
    if ('cron' in a) return CRON_JOB.test(a.cron) ? { actor: `cron:${a.cron}`, metadata: {} } : SYSTEM_UNRESOLVED
    if ('webhook' in a) return WEBHOOK_PROVIDER.test(a.webhook) ? { actor: `webhook:${a.webhook}`, metadata: {} } : SYSTEM_UNRESOLVED
    if ('userId' in a) return userActor(a.userId)
    const { auth } = await import('@clerk/nextjs/server')
    return userActor((await auth()).userId)
  } catch {
    return SYSTEM_UNRESOLVED
  }
}

/**
 * The chain for an event. If it cannot be told, the platform chain, marked, rather than
 * a guess at a tenant: the table is append-only, so a row on the wrong tenant's chain
 * stays there. A miss or a read error is unresolved, never Stellr.
 */
export async function resolveTenant(t: AuditTenant, opts: { db?: AuditOptions['db'] } = {}): Promise<ResolvedTenant> {
  try {
    if ('stellr' in t) return { tenantId: STELLR_TENANT_ID, metadata: {} }
    if ('tenantId' in t) return { tenantId: t.tenantId, metadata: {} }
    const { getMirroredEvent } = await import('@/lib/events/mirror')
    const event = await getMirroredEvent(t.eventSlug, { db: opts.db ?? auditClient() })
    return event ? { tenantId: event.tenant_id, metadata: {} } : TENANT_UNRESOLVED
  } catch {
    return TENANT_UNRESOLVED
  }
}

/** The work's answer, or the fallback once `ms` has gone. */
function within<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms)
    ;(t as { unref?: () => void }).unref?.()
    const finish = (v: T) => {
      clearTimeout(t)
      resolve(v)
    }
    work.then(finish, () => finish(fallback))
  })
}

async function write(m: AuditMutation, opts: AuditMutationOptions): Promise<AuditResult> {
  try {
    // One budget for the whole write. The lookups get half, so a hung Clerk or mirror
    // read leaves the event time to be written, marked.
    const budget = opts.timeoutMs ?? AUDIT_TIMEOUT_MS
    const started = Date.now()
    const [actor, tenant] = await Promise.all([
      within(resolveActor(m.actor), budget / 2, SYSTEM_UNRESOLVED),
      within(resolveTenant(m.tenant, { db: opts.db }), budget / 2, TENANT_UNRESOLVED),
    ])
    const badId = !!m.target?.id && !isStorableTargetId(m.target.id)
    return await audit(
      {
        tenantId: tenant.tenantId,
        actor: actor.actor,
        action: m.action,
        target: m.target ? { table: m.target.table, id: badId ? null : m.target.id } : null,
        reason: m.reason,
        metadata: { ...m.metadata, ...actor.metadata, ...tenant.metadata, ...(badId ? { target_id_dropped: true } : {}) },
      },
      { db: opts.db, enabled: true, timeoutMs: Math.max(1, budget - (Date.now() - started)) },
    )
  } catch (err) {
    await recordAuditFailure(err, m.action, opts.db)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Record one mutation. Never throws, and does nothing while the flag is off. */
export async function auditMutation(m: AuditMutation, opts: AuditMutationOptions = {}): Promise<AuditMutationResult> {
  try {
    if (!(opts.enabled ?? auditEnabled())) return { ok: false, skipped: 'disabled' }
    if (opts.afterResponse) {
      runAfterResponse('platform-audit', () => write(m, opts))
      return { ok: false, skipped: 'deferred' }
    }
    return await write(m, opts)
  } catch (err) {
    await recordAuditFailure(err, m?.action ?? 'unknown', opts.db)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** What withAudit's spec can see, for an event that depends on the request or its answer. */
export interface AuditedOutcome<Args extends unknown[]> {
  args: Args
  /** The handler's response, or null when it threw. */
  response: Response | null
}

/** A refusal: the handler chose not to do the thing, so there is no mutation to record. */
const isRefusal = (status: number) => status >= 400 && status < 500

/**
 * The status a thrown error answers with. Next's notFound(), forbidden(), unauthorized()
 * and redirect() throw an error whose digest carries one, and that is control flow, not
 * a failure. Anything else is a 500.
 */
function thrownStatus(err: unknown): number {
  const digest = (err as { digest?: unknown } | null | undefined)?.digest
  if (typeof digest !== 'string') return 500
  const parts = digest.split(';')
  const raw = parts[0] === 'NEXT_REDIRECT' ? parts.at(-2) : parts[0] === 'NEXT_HTTP_ERROR_FALLBACK' ? parts[1] : undefined
  const status = Number(raw)
  return raw && Number.isInteger(status) ? status : 500
}

/**
 * Wrap a route handler so that any answer other than a 4xx records one event,
 * after the response unless the caller's options say afterResponse: false. A 2xx or
 * 3xx did the work; a 5xx or a throw may have done part of it, so those are recorded
 * too, with the status. A notFound() or redirect() counts as the status it answers with.
 *
 * The handler's answer and error always pass through unchanged, and a spec
 * function that throws costs the event, never the request. A 4xx after a partial
 * write is not recorded: a handler that can do that should report it as a 5xx.
 *
 * A cron's guardCron stays the first statement of the handler given here: that is
 * where test/route-manifest.test.ts reads it.
 */
export function withAudit<Args extends unknown[], R extends Response>(
  spec: AuditMutation | ((outcome: AuditedOutcome<Args>) => AuditMutation),
  handler: (...args: Args) => Promise<R> | R,
  callerOpts: AuditMutationOptions = {},
): (...args: Args) => Promise<R> {
  const opts: AuditMutationOptions = { afterResponse: true, ...callerOpts }
  const record = async (args: Args, response: R | null, status: number) => {
    try {
      if (!(opts.enabled ?? auditEnabled())) return
      const m = typeof spec === 'function' ? spec({ args, response }) : spec
      await auditMutation({ ...m, metadata: { ...m.metadata, status } }, opts)
    } catch (err) {
      await recordAuditFailure(err, typeof spec === 'function' ? 'with_audit' : spec.action, opts.db)
    }
  }
  return async (...args: Args) => {
    let response: R
    try {
      response = await handler(...args)
    } catch (err) {
      const status = thrownStatus(err)
      if (!isRefusal(status)) await record(args, null, status)
      throw err
    }
    if (!isRefusal(response.status)) await record(args, response, response.status)
    return response
  }
}
