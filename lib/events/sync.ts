/**
 * The Postgres events mirror (multi-tenancy plan S3): copy a Sanity event
 * document into public.events (supabase/migrations/20261104110000).
 *
 * Sanity stays the source of truth for event content. The mirror exists so
 * the database can answer "which tenant owns this event?" — for the tenant_id
 * derivation trigger now, for RLS in S4. NOTHING on a live flow reads it, and
 * nothing on the registration path may await it: callers that sync in-line
 * are the event webhook (after its own work, through syncEventMirrorSafe, which
 * never throws), lib/events/mirror.ts's background sync on a miss, and
 * scripts/backfill-events-mirror.ts.
 *
 * Every event document is Stellr's until S8 gives events an owner of their own, so
 * a NEW row's tenant defaults to STELLR_TENANT_ID. An existing row keeps its tenant
 * (upsertEventRows), and the sync on a miss must name one (lib/events/mirror.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { eventTimeZone, zonedTimeToUtc } from '@/lib/survey/timezone'

/** The Sanity fields the mirror keeps. No personal data: event documents are public. */
export const MIRROR_PROJECTION = `{
  _id, _updatedAt, title, "slug": slug.current, activityType, type, gradeLevel, gradeMin, gradeMax,
  date, endDate, startTime, endTime, setting, venue, city, state, country, status,
  registrationOpen, registrationOpenDate, registrationCloseDate, capacity, season, campaignYear, deadline
}`

/** A Sanity event document as MIRROR_PROJECTION returns it (slug flattened). */
export interface SanityEventDoc {
  _id: string
  _updatedAt?: string | null
  title?: string | null
  slug?: string | { current?: string } | null
  activityType?: string | null
  date?: string | null
  endDate?: string | null
  state?: string | null
  country?: string | null
  status?: string | null
  [key: string]: unknown
}

/** A row of public.events as the mirror writes it. */
export interface EventRow {
  tenant_id: string
  slug: string
  sanity_id: string
  title: string
  activity_type: 'live_event' | 'campaign'
  starts_at: string | null
  ends_at: string | null
  time_zone: string
  country: string
  currency: 'usd' | 'aud'
  grade_system: 'us_grades' | 'au_years'
  min_participant_age: number | null
  status: string | null
  raw: Record<string, unknown>
  source_updated_at: string | null
  synced_at: string
}

export interface TenantDefaults {
  tenantId: string
  currency: 'usd' | 'aud'
}

export const STELLR_DEFAULTS: TenantDefaults = { tenantId: STELLR_TENANT_ID, currency: 'usd' }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** ISO 3166 alpha-2 of the venue. Blank means the US (the Studio field says so). */
export function eventCountry(raw: string | null | undefined): string {
  const c = (raw ?? '').trim().toUpperCase()
  if (!c || c === 'USA') return 'US'
  return /^[A-Z]{2}$/.test(c) ? c : 'US'
}

/**
 * Map a Sanity event document to a mirror row. Pure. Returns null for anything
 * the mirror must not hold: no _id, a draft, or no slug.
 *
 * starts_at is local midnight of the first day in the event's zone; ends_at is
 * the EXCLUSIVE end — local midnight after the last day — so "is it on?" is
 * starts_at <= now < ends_at. Undated events (campaigns) have neither.
 */
export function toEventRow(
  doc: SanityEventDoc,
  tenant: TenantDefaults = STELLR_DEFAULTS,
  now: Date = new Date(),
): EventRow | null {
  if (!doc || typeof doc._id !== 'string' || !doc._id || doc._id.startsWith('drafts.')) return null
  const slug = typeof doc.slug === 'string' ? doc.slug : doc.slug?.current
  if (!slug || typeof slug !== 'string') return null

  const country = eventCountry(doc.country)
  const timeZone = eventTimeZone({ state: doc.state ?? null, country })
  const first = typeof doc.date === 'string' && ISO_DATE.test(doc.date) ? doc.date : null
  const lastRaw = typeof doc.endDate === 'string' && ISO_DATE.test(doc.endDate) ? doc.endDate : first
  const last = first && lastRaw && lastRaw >= first ? lastRaw : first
  const startsAt = first ? zonedTimeToUtc(first, timeZone).toISOString() : null
  const endsAt = last ? zonedTimeToUtc(nextDay(last), timeZone).toISOString() : null

  const { slug: _s, ...rest } = doc
  void _s
  return {
    tenant_id: tenant.tenantId,
    slug,
    sanity_id: doc._id,
    title: (typeof doc.title === 'string' && doc.title.trim()) || slug,
    activity_type: doc.activityType === 'campaign' ? 'campaign' : 'live_event',
    starts_at: startsAt,
    ends_at: endsAt,
    time_zone: timeZone,
    country,
    currency: country === 'AU' ? 'aud' : tenant.currency,
    grade_system: country === 'AU' ? 'au_years' : 'us_grades',
    min_participant_age: null,
    status: typeof doc.status === 'string' ? doc.status.slice(0, 40) : null,
    raw: { ...rest, slug },
    source_updated_at: typeof doc._updatedAt === 'string' ? doc._updatedAt : null,
    synced_at: now.toISOString(),
  }
}

/**
 * Upsert mirror rows, matched on the Sanity _id (a renamed slug updates in place).
 *
 * A sync never changes who owns an event. A row that already exists under another
 * tenant keeps that tenant and its currency, so republishing a document cannot move
 * an event to the default owner. If the owners cannot be read, nothing is written.
 */
export async function upsertEventRows(db: SupabaseClient, rows: EventRow[]): Promise<{ error: string | null }> {
  if (rows.length === 0) return { error: null }
  const { data, error: readError } = await db
    .from('events')
    .select('sanity_id, tenant_id, currency')
    .in('sanity_id', rows.map((r) => r.sanity_id))
  if (readError) return { error: readError.message }
  const owners = new Map(
    ((data ?? []) as Pick<EventRow, 'sanity_id' | 'tenant_id' | 'currency'>[]).map((o) => [o.sanity_id, o]),
  )
  const kept = rows.map((row) => {
    const owner = owners.get(row.sanity_id)
    if (!owner || owner.tenant_id === row.tenant_id) return row
    // An Australian venue is priced in AUD whoever owns it (toEventRow).
    return { ...row, tenant_id: owner.tenant_id, currency: row.country === 'AU' ? row.currency : owner.currency }
  })
  const { error } = await db.from('events').upsert(kept, { onConflict: 'sanity_id' })
  return { error: error ? error.message : null }
}

/** Fetch one published event from Sanity, uncached, by _id or slug. */
export type EventFetcher = (by: { sanityId?: string; slug?: string }) => Promise<SanityEventDoc | null>

export const fetchSanityEvent: EventFetcher = async (by) => {
  const { client } = await import('@/lib/sanity')
  if (!client) return null
  if (by.sanityId) {
    return client.fetch(`*[_type == "event" && _id == $id][0] ${MIRROR_PROJECTION}`, { id: by.sanityId }, { cache: 'no-store' })
  }
  if (by.slug) {
    return client.fetch(
      `*[_type == "event" && slug.current == $slug && !(_id in path("drafts.**"))][0] ${MIRROR_PROJECTION}`,
      { slug: by.slug },
      { cache: 'no-store' },
    )
  }
  return null
}

export type SyncResult =
  | { status: 'synced'; slug: string; sanityId: string }
  | { status: 'missing' }
  | { status: 'skipped'; reason: string }
  | { status: 'error'; error: string }

/**
 * Re-read one event from Sanity and write it to the mirror. Never deletes: an
 * event that is gone from Sanity reports 'missing' and its row stays (rows in
 * 32 tables may still point at it).
 */
export async function syncEventFromSanity(
  db: SupabaseClient,
  by: { sanityId?: string; slug?: string },
  opts: { fetcher?: EventFetcher; tenant?: TenantDefaults; now?: Date } = {},
): Promise<SyncResult> {
  if (!by.sanityId && !by.slug) return { status: 'skipped', reason: 'no _id or slug' }
  const doc = await (opts.fetcher ?? fetchSanityEvent)(by)
  if (!doc) return { status: 'missing' }
  const row = toEventRow(doc, opts.tenant, opts.now)
  if (!row) return { status: 'skipped', reason: 'not a mirrorable event (draft or no slug)' }
  const { error } = await upsertEventRows(db, [row])
  if (error) return { status: 'error', error }
  return { status: 'synced', slug: row.slug, sanityId: row.sanity_id }
}

/** Default cap on how long the webhook waits for the mirror. */
export const MIRROR_TIMEOUT_MS = 8_000

/**
 * syncEventFromSanity for the event webhook: never throws, never waits longer
 * than `timeoutMs`, and records a failure in app_errors (lib/app-errors.ts)
 * instead of failing the request. The webhook's own work is done before this
 * runs and its response does not depend on the result.
 */
export async function syncEventMirrorSafe(
  db: SupabaseClient,
  by: { sanityId?: string; slug?: string },
  opts: {
    fetcher?: EventFetcher
    timeoutMs?: number
    route?: string
    report?: (err: unknown, route: string) => Promise<void>
  } = {},
): Promise<SyncResult | { status: 'timeout' }> {
  const route = opts.route ?? '/api/admin/sanity/event-sync'
  const report =
    opts.report ??
    (async (err: unknown, r: string) => {
      const { captureRequestError } = await import('@/lib/app-errors')
      await captureRequestError(err, { method: 'POST', path: r }, { routePath: r, routeType: 'route' })
    })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<{ status: 'timeout' }>((resolve) => {
      timer = setTimeout(() => resolve({ status: 'timeout' }), opts.timeoutMs ?? MIRROR_TIMEOUT_MS)
    })
    const result = await Promise.race([syncEventFromSanity(db, by, { fetcher: opts.fetcher }), timeout])
    if (result.status === 'error' || result.status === 'timeout') {
      const detail = result.status === 'error' ? result.error : 'timed out'
      await report(new Error(`events mirror sync failed: ${detail}`), route).catch(() => {})
    }
    return result
  } catch (err) {
    console.error('[events-mirror] sync failed:', err instanceof Error ? err.message : err)
    await report(err, route).catch(() => {})
    return { status: 'error', error: err instanceof Error ? err.message : String(err) }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
