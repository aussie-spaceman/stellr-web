import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import {
  ELIGIBILITY_UNAVAILABLE_MESSAGE,
  eligibilityContextFromMirror,
  eligibilityContextProblem,
  stellrContext,
  type EligibilityContext,
  type EligibilityUnavailableDetail,
  type MirrorEventForEligibility,
  type TenantForEligibility,
} from './eligibility'
import { temporarilyUnavailable } from './refusal'

// Which event a registration is for, and whose (multi-tenancy plan S5, A7). Every
// register route resolves its event here before it writes anything.
//
// Two reads, in this order:
//   1. The event from the CMS, exactly as each route read it before: its content
//      (title, dates, window, price) still comes from there, as the register pages'
//      does. A miss is still a miss, and a failed read is still retryable.
//   2. Its owner, from the events mirror (public.events). A slug the mirror does not
//      hold is Stellr's: Sanity is Stellr's source of truth, and the derivation trigger
//      stamps such a registration Stellr too. A failed read refuses, retryably: it is
//      never taken to mean Stellr, because a tenant's event read as Stellr's would have
//      no age floor.
//
// An event owned by a tenant other than the request's is answered as if it did not
// exist, on every host: a tenant host can't reach Stellr's events or another tenant's,
// and Stellr's hosts can't reach a tenant's. The request's tenant comes from
// requestTenant(), which is always Stellr while tenant routing is off, so with
// that flag off no request ever gets a tenant context.
//
// Where the owner read falls: on a tenant's host, straight after the CMS read, because
// the tenant's rules decide every check that follows. On Stellr's hosts an event can
// only go ahead as Stellr's, so the checks that need no database read (the window, the
// form, dates of birth under Stellr's rules) keep their order and answers, and the
// owner is read before the first read about the person and before any write
// (deferredEventContext). So on Stellr's hosts those form refusals can still answer
// for another tenant's event before the owner read says it is not found.
//
// For Stellr's events the result is stellrContext(event): the same date, the same call
// to checkRegistrationAge, the same answers as before this file existed. The one thing
// it adds is the owner read.

/** What a register route knows about the event once it is resolved. */
export interface RegistrationEventContext {
  /** The event's owner. Supplied as tenant_id on every row the route writes. */
  tenantId: string
  /** True only for Stellr's own events. Everything Stellr-only waits on this. */
  isPlatformOwner: boolean
  /** For assertEligible. A platform-owner context for Stellr, a tenant context otherwise. */
  eligibility: EligibilityContext
}

/** The CMS read alone: the first half of resolveRegistrationEvent. */
export type EventRead<E> = { kind: 'ok'; event: E } | { kind: 'not_found' } | { kind: 'unavailable' }

/** The owner read alone: the second half of resolveRegistrationEvent. */
export type OwnerResolution =
  | { kind: 'ok'; context: RegistrationEventContext }
  | { kind: 'not_found' }
  | { kind: 'unavailable' }
  | { kind: 'rules_unavailable'; detail: EligibilityUnavailableDetail }

export type EventResolution<E> =
  | { kind: 'ok'; event: E; context: RegistrationEventContext }
  /** No such event, or one owned by a tenant other than the request's. Each route keeps its own answer. */
  | { kind: 'not_found' }
  /** A read failed. Retryable. */
  | { kind: 'unavailable' }
  /** A tenant event whose eligibility rules can't be worked out, such as a live event with no start date. */
  | { kind: 'rules_unavailable'; detail: EligibilityUnavailableDetail }

export interface ResolveEventDeps<E> {
  db: SupabaseClient
  getEvent: (slug: string) => Promise<E | null>
  /** requestTenant().tenantId for this request. */
  requestTenantId: string
  /** For logs. */
  route: string
}

type MirrorRow = MirrorEventForEligibility

const MIRROR_OWNER_COLUMNS = 'tenant_id, activity_type, starts_at, time_zone, min_participant_age'

/**
 * The tenant that owns an event according to the mirror: its row's tenant, Stellr
 * when the mirror has no row, or 'error' when a read failed.
 *
 * When the CMS document's id is known, the row is found by it first (the mirror's
 * unique sanity_id). A slug can change in the CMS before the mirror catches up, so
 * the document's id is what ties a renamed event to its owner. Only when no row has
 * that id is the row found by its unique slug.
 *
 * The database stamps registrations and participants by slug alone
 * (public.tenancy_derive_tenant_id): the row with this slug decides their tenant, and
 * with no such row the tenant the app supplies is kept. So the answer here must agree
 * with the slug's row wherever one exists. When the document's row already holds this
 * slug it is that row, and one read settles it. Otherwise (a rename the mirror has not
 * caught up with) the slug's row is read too, and if it names a different owner the
 * answer is a failed read, retryable, rather than an approval under one owner that the
 * trigger stamps under another. Reads: one when the document's row holds the slug or
 * no document id is known; two when the document's row holds another slug, or the
 * mirror has no row for the document.
 */
export async function eventOwner(
  db: SupabaseClient,
  slug: string,
  sanityId?: string | null,
): Promise<{ ok: true; tenantId: string; row: MirrorRow | null } | { ok: false }> {
  if (sanityId) {
    const { data, error } = await db.from('events').select(`${MIRROR_OWNER_COLUMNS}, slug`).eq('sanity_id', sanityId).maybeSingle()
    if (error) return { ok: false }
    const found = (data as (MirrorRow & { slug?: string | null }) | null) ?? null
    if (found) {
      const { slug: rowSlug, ...row } = found
      const tenantId = row.tenant_id ?? STELLR_TENANT_ID
      if (rowSlug === slug) return { ok: true, tenantId, row }
      const bySlug = await db.from('events').select('tenant_id').eq('slug', slug).maybeSingle()
      if (bySlug.error) return { ok: false }
      const slugRow = (bySlug.data as { tenant_id: string | null } | null) ?? null
      if (slugRow && (slugRow.tenant_id ?? STELLR_TENANT_ID) !== tenantId) {
        console.error('[event-context] the event’s mirror rows by document and by slug name different owners:', slug)
        return { ok: false }
      }
      return { ok: true, tenantId, row }
    }
  }
  const { data, error } = await db.from('events').select(MIRROR_OWNER_COLUMNS).eq('slug', slug).maybeSingle()
  if (error) return { ok: false }
  const row = (data as MirrorRow | null) ?? null
  return { ok: true, tenantId: row?.tenant_id ?? STELLR_TENANT_ID, row }
}

/** The CMS document id of an event read from the CMS, when it carries one. */
function cmsDocumentId(event: unknown): string | null {
  const id = (event as { _id?: unknown } | null)?._id
  return typeof id === 'string' && id.length > 0 && !id.startsWith('drafts.') ? id : null
}

/** Resolve a register route's event and its owner. Never throws. */
export async function resolveRegistrationEvent<E extends { date?: string | null }>(
  slug: string,
  deps: ResolveEventDeps<E>,
): Promise<EventResolution<E>> {
  const read = await readRegistrationEvent(slug, deps)
  if (read.kind !== 'ok') return read
  const owner = await resolveEventOwner(read.event, slug, deps)
  return owner.kind === 'ok' ? { kind: 'ok', event: read.event, context: owner.context } : owner
}

/**
 * The CMS read, as each route made it before: a miss is not_found and a throw is
 * unavailable. A route that answers some refusals before it takes a database client
 * reads the event here first, then calls resolveEventOwner where it takes the client.
 */
export async function readRegistrationEvent<E>(
  slug: string,
  deps: Pick<ResolveEventDeps<E>, 'getEvent' | 'route'>,
): Promise<EventRead<E>> {
  try {
    const event = await deps.getEvent(slug)
    return event ? { kind: 'ok', event } : { kind: 'not_found' }
  } catch (e) {
    console.error(`[${deps.route}] event lookup failed:`, e)
    return { kind: 'unavailable' }
  }
}

/** The owner of an event already read from the CMS, and its rules. Never throws. */
export async function resolveEventOwner<E extends { date?: string | null }>(
  event: E,
  slug: string,
  deps: Pick<ResolveEventDeps<E>, 'db' | 'requestTenantId' | 'route'>,
): Promise<OwnerResolution> {
  let owner: Awaited<ReturnType<typeof eventOwner>>
  try {
    owner = await eventOwner(deps.db, slug, cmsDocumentId(event))
  } catch (e) {
    console.error(`[${deps.route}] event owner lookup failed:`, e)
    return { kind: 'unavailable' }
  }
  if (!owner.ok) {
    console.error(`[${deps.route}] event owner lookup failed`)
    return { kind: 'unavailable' }
  }
  if (owner.tenantId !== deps.requestTenantId) return { kind: 'not_found' }

  if (owner.tenantId === STELLR_TENANT_ID) {
    const eligibility = stellrContext(event)
    return { kind: 'ok', context: { tenantId: STELLR_TENANT_ID, isPlatformOwner: eligibility.isPlatformOwner, eligibility } }
  }

  let tenant: TenantForEligibility | null
  try {
    const { data, error } = await deps.db
      .from('tenants')
      .select('id, is_platform_owner, min_participant_age')
      .eq('id', owner.tenantId)
      .maybeSingle()
    if (error) {
      console.error(`[${deps.route}] tenant lookup failed:`, error.message)
      return { kind: 'unavailable' }
    }
    tenant = (data as TenantForEligibility | null) ?? null
  } catch (e) {
    console.error(`[${deps.route}] tenant lookup failed:`, e)
    return { kind: 'unavailable' }
  }

  const eligibility = eligibilityContextFromMirror(owner.row, tenant)
  // A tenant's event is never given Stellr's rules, even if its rows say so: the
  // owner read named a tenant other than Stellr.
  if (eligibility.kind !== 'tenant') {
    return { kind: 'rules_unavailable', detail: eligibility.kind === 'unresolved' ? eligibility.detail : 'tenant_mismatch' }
  }
  const problem = eligibilityContextProblem(eligibility)
  if (problem) return { kind: 'rules_unavailable', detail: problem }
  return { kind: 'ok', context: { tenantId: owner.tenantId, isPlatformOwner: false, eligibility } }
}

/**
 * resolveEventOwner, with its refusals as answers: the retryable 503, the route's
 * own answer for an unknown event (`notFound`), or the eligibility 503.
 */
export async function eventOwnerOrRefusal<E extends { date?: string | null }>(
  event: E,
  slug: string,
  deps: Pick<ResolveEventDeps<E>, 'db' | 'requestTenantId' | 'route'>,
  notFound: () => Response,
): Promise<{ ok: true; context: RegistrationEventContext } | { ok: false; response: Response }> {
  const owned = await resolveEventOwner(event, slug, deps)
  if (owned.kind === 'ok') return { ok: true, context: owned.context }
  if (owned.kind === 'not_found') return { ok: false, response: notFound() }
  if (owned.kind === 'rules_unavailable') return { ok: false, response: eligibilityUnavailable() }
  return { ok: false, response: temporarilyUnavailable() }
}

/**
 * The event's rules now, and its owner when a step first needs it (S5 A7).
 *
 * On a tenant's host the owner is read before anything else, because the tenant's
 * rules decide every check: `eligibility` is the tenant's and `confirm` answers at
 * once. On Stellr's hosts an event can only go ahead as Stellr's, so `eligibility`
 * is Stellr's, the same checks as before A7, and `confirm` reads the owner the first
 * time it is called. A route calls it before its first read about the person and
 * before any write, so an event owned by anyone else is refused before then, and the
 * checks that need no read keep the order and answers they had.
 */
export interface DeferredEventContext {
  eligibility: EligibilityContext
  confirm(): Promise<{ ok: true; context: RegistrationEventContext } | { ok: false; response: Response }>
}

export async function deferredEventContext<E extends { date?: string | null }>(
  event: E,
  slug: string,
  deps: Pick<ResolveEventDeps<E>, 'db' | 'requestTenantId' | 'route'>,
  notFound: () => Response,
): Promise<{ ok: true; owner: DeferredEventContext } | { ok: false; response: Response }> {
  let settled: ReturnType<DeferredEventContext['confirm']> | null = null
  const confirm = () => (settled ??= eventOwnerOrRefusal(event, slug, deps, notFound))
  if (deps.requestTenantId !== STELLR_TENANT_ID) {
    const owned = await confirm()
    if (!owned.ok) return owned
    return { ok: true, owner: { eligibility: owned.context.eligibility, confirm } }
  }
  return { ok: true, owner: { eligibility: stellrContext(event), confirm } }
}

/**
 * The answer for a tenant event whose eligibility rules can't be worked out. Nobody
 * is admitted, and nothing about the person was looked at. Wording is a proposal.
 */
export const eligibilityUnavailable = (): Response =>
  NextResponse.json({ code: 'eligibility_unavailable', error: ELIGIBILITY_UNAVAILABLE_MESSAGE }, { status: 503 })

/**
 * The answer for a tenant event that would take money (S5 A7: priced tenant events
 * fail closed until S9 ships the ledger). Nothing is written, and no Checkout session
 * or invoice is made on Stellr's Stripe account. Wording is a proposal.
 */
export const tenantPaymentsUnavailable = (): Response =>
  NextResponse.json(
    {
      code: 'tenant_payments_unavailable',
      error: 'Paid registration for this event isn’t available online yet. Please contact the event organiser.',
    },
    { status: 503 },
  )

/** The tenant a registration row belongs to: its tenant_id, or Stellr for a row the backfill has not reached. */
export function rowTenant(tenantId: string | null | undefined): string {
  return tenantId ?? STELLR_TENANT_ID
}
