// May this scope act on the event named in a URL (S5 C17, lib/authz requireEventRoute)? The
// event's own tenant decides, from the mirror. Sanity is the source of truth for an event and
// `events` is a background mirror, so a slug with no row counts as Stellr's when Sanity knows
// it, as the derivation trigger and lib/authz read it. Another tenant's event and a slug
// nobody knows answer the same.
//
// Off, in Stellr's tenant-wide scope, this reads nothing and answers yes, which is today.
// Shadow reads and answers yes, and logs a no. Enforced, or for any other scope, the answer
// stands, and a read that fails is a no.

import { loadScopedMode, reportUnrecognisedMode, type LoadScopedMode } from './load-scoped-mode'
import { assertMadeScope, isStellrScope, type ScopeContext } from './scope-context'

/** Same character set as a route's slug key: anything else is no event. */
const SLUG = /^[A-Za-z0-9._:-]{1,200}$/

interface EventsTable {
  from(table: 'events'): {
    select(columns: string): {
      eq(column: string, value: string): { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> }
    }
  }
}

export interface EventInScopeOptions {
  /** A getter, so off makes no client and no query. */
  db: () => unknown
  /** Does the event exist outside the mirror (Sanity)? Asked only of Stellr's scope, for a slug the mirror does not hold. */
  existsUnmirrored: () => Promise<boolean>
  mode?: LoadScopedMode
  label?: string
}

async function logNo(scope: ScopeContext, label: string, reason: 'presence' | 'scoped_error'): Promise<void> {
  try {
    const { captureRequestError } = await import('@/lib/app-errors')
    const message = `loadScoped shadow mismatch: public.events ${reason} (legacy found, scoped missing, actor ${scope.actor.kind})`
    await captureRequestError(new Error(message), { method: 'LOADSCOPED', path: label }, { routePath: label })
  } catch (e) {
    console.error('[load-scoped] shadow log failed:', e instanceof Error ? e.message : e)
  }
}

export async function eventInScope(scope: ScopeContext, slug: string, opts: EventInScopeOptions): Promise<boolean> {
  assertMadeScope(scope)
  if (opts.mode === undefined) await reportUnrecognisedMode()
  const requested = opts.mode ?? loadScopedMode()
  const mode = isStellrScope(scope) && scope.eventSlugs === null ? requested : 'enforce'
  if (mode === 'off') return true

  const owned = async (): Promise<boolean> => {
    if (!SLUG.test(slug)) return false
    const { data, error } = await (opts.db() as EventsTable).from('events').select('tenant_id').eq('slug', slug).maybeSingle()
    if (error) throw error
    const tenantId = (data as { tenant_id?: string | null } | null)?.tenant_id ?? null
    if (tenantId) return tenantId === scope.tenantId
    return isStellrScope(scope) && (await opts.existsUnmirrored())
  }
  let inScope = false
  let failed = false
  try {
    inScope = await owned()
  } catch {
    failed = true
    console.error('[load-scoped] the event read failed')
  }
  if (mode === 'enforce') return inScope
  if (!inScope) await logNo(scope, opts.label ?? 'public.events', failed ? 'scoped_error' : 'presence')
  return true
}
