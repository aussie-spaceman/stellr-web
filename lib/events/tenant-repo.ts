/**
 * The events facade's Postgres door (S5 C8 and C25, docs/TENANCY-S5.md). Reads an
 * event from the Postgres mirror (public.events) for ONE named tenant, and returns
 * it in the shape lib/sanity returns for the same getter.
 *
 * Not wired to any caller yet. lib/events/repo.ts stays Sanity-only and imports
 * nothing but lib/sanity (test/events-facade-ratchet.test.ts), so a page that reads
 * an event still loads no database client. Moving callers here, and looping crons
 * over tenants, is a later slice.
 *
 * The C8 amendment's rules, which every getter here follows:
 *   • The tenant is an explicit argument. The caller takes it from the registration
 *     or member row it already holds, never from request headers or the Host.
 *   • A missing, blank or malformed tenant throws (TenantRequiredError). Nothing
 *     falls back to Stellr: a fallback would answer a tenant's slug with Stellr's
 *     event once slugs are unique per tenant (S8).
 *   • Every query filters tenant_id, and a row that comes back under another tenant
 *     is dropped as well, so a slug two tenants share resolves only within the
 *     tenant passed in.
 *   • A read error throws, rather than answering null or [], so an outage never
 *     reads as "no such event".
 *
 * The caller brings the client. This module never builds or imports one of its
 * own (lib/events/tenant-repo.test.ts checks), and only reads.
 *
 * Shape: the mirror keeps the fields in lib/events/sync.ts's MIRROR_PROJECTION, in
 * the `raw` column, beside typed columns the database owns. Typed columns win where
 * both exist (title, activity type, dates, country, status), because a tenant's row
 * may have been written without a CMS document behind it. The fields the mirror
 * does not hold are listed in MIRROR_DETAIL_GAPS and are always absent here; a
 * caller that needs one keeps reading Sanity for it until S8 moves event content
 * into Postgres. lib/events/tenant-repo.test.ts holds both lists against the
 * projections in lib/sanity.ts, so a field added there fails until it is mapped or
 * listed as a gap.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EventMeta, StellarEvent } from '@/lib/sanity'
import { localDate } from '@/lib/survey/timezone'

/** Thrown when a getter is called without a usable tenant id. */
export class TenantRequiredError extends Error {
  constructor(message = 'events facade: a tenant id is required') {
    super(message)
    this.name = 'TenantRequiredError'
  }
}

/** A row of public.events, as much of it as the adapter reads. */
export interface TenantEventRow {
  tenant_id: string
  slug: string
  sanity_id: string
  title: string
  activity_type: string
  starts_at: string | null
  ends_at: string | null
  time_zone: string
  country: string
  status: string | null
  raw: Record<string, unknown> | null
}

/** The columns every getter selects. No personal data: the table holds event content only. */
export const TENANT_EVENT_COLUMNS =
  'tenant_id, slug, sanity_id, title, activity_type, starts_at, ends_at, time_zone, country, status, raw'

/**
 * lib/sanity's getEventBySlug fields the adapter fills, from the typed columns or
 * from `raw` (MIRROR_PROJECTION).
 */
export const MIRROR_DETAIL_FIELDS = [
  '_id', 'title', 'slug', 'type', 'gradeLevel', 'gradeMin', 'gradeMax', 'date', 'endDate', 'activityType',
  'setting', 'season', 'campaignYear', 'deadline', 'venue', 'city', 'state', 'registrationOpen',
  'registrationOpenDate', 'registrationCloseDate', 'capacity', 'country', 'startTime', 'endTime', 'status',
] as const

/**
 * lib/sanity's getEventBySlug fields the mirror does not hold, so the adapter never
 * returns them. Known gaps, not oversights: none is in MIRROR_PROJECTION. Pages that
 * render an event (description, flyers, image, schedule, price) keep reading Sanity
 * until S8.
 */
export const MIRROR_DETAIL_GAPS = [
  'term', 'deliverable', 'tagline', 'description', 'image', 'flyers', 'stripePriceId', 'schedule',
  'latitude', 'longitude', 'previousStartDate', 'hubspotLocation',
] as const

type DetailField = (typeof MIRROR_DETAIL_FIELDS)[number]

/**
 * What getEventBySlugForTenant returns: lib/sanity's StellarEvent narrowed to the
 * fields the mirror holds. Optional fields are absent, not null, when unknown.
 */
export type TenantEventDetail = Pick<StellarEvent, DetailField>

/** What getEventsBySlugsForTenant returns: lib/sanity's EventMeta, every field it projects. */
export type TenantEventMeta = Pick<EventMeta, '_id' | 'title' | 'slug' | 'activityType' | 'date' | 'endDate' | 'setting'>

/** What getEventsByIdsForTenant returns: lib/sanity's getEventsByIds projection (no endDate or setting). */
export type TenantEventIdMeta = Pick<EventMeta, '_id' | 'title' | 'slug' | 'activityType' | 'date'>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const STATUSES = new Set(['scheduled', 'cancelled', 'postponed', 'rescheduled', 'moved_online'])

/**
 * PostgREST sends `.in()` values in the URL, so a long list goes in chunks. Sanity's
 * getters take any length; so do these.
 */
const IN_CHUNK = 100

/** The tenant id, trimmed, or a throw. Never a default. */
export function requireTenantId(tenantId: unknown): string {
  if (typeof tenantId !== 'string' || !tenantId.trim()) throw new TenantRequiredError()
  const id = tenantId.trim()
  if (!UUID.test(id)) throw new TenantRequiredError('events facade: the tenant id is not a uuid')
  return id
}

// ── Adapter ──────────────────────────────────────────────────────────────────

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

function isoDate(v: unknown): string | undefined {
  return typeof v === 'string' && ISO_DATE.test(v) ? v : undefined
}

/** Copy only the keys whose value is defined, so an unknown field is absent rather than undefined. */
function defined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

/**
 * The event's first and last local day. From starts_at / ends_at in the row's zone
 * when the row has them (ends_at is the EXCLUSIVE end, local midnight after the last
 * day), else from raw's date / endDate. Sanity leaves endDate unset on a one-day
 * event, so it is returned only when the last day differs from the first or the CMS
 * document set one.
 */
function eventDays(row: TenantEventRow, raw: Record<string, unknown>): { date?: string; endDate?: string } {
  const rawDate = isoDate(raw.date)
  const rawEnd = isoDate(raw.endDate)
  const start = row.starts_at ? new Date(row.starts_at) : null
  if (!start || Number.isNaN(start.getTime())) return { date: rawDate, endDate: rawEnd }
  const zone = row.time_zone || 'UTC'
  const date = localDate(start, zone)
  const end = row.ends_at ? new Date(new Date(row.ends_at).getTime() - 1) : null
  const last = end && !Number.isNaN(end.getTime()) ? localDate(end, zone) : null
  const endDate = last && last > date ? last : rawEnd && rawEnd >= date ? rawEnd : undefined
  return { date, endDate }
}

function rawOf(row: TenantEventRow): Record<string, unknown> {
  return row.raw && typeof row.raw === 'object' && !Array.isArray(row.raw) ? row.raw : {}
}

function activityTypeOf(row: TenantEventRow): 'live_event' | 'campaign' {
  return row.activity_type === 'campaign' ? 'campaign' : 'live_event'
}

function settingOf(raw: Record<string, unknown>): 'in_person' | 'virtual' | undefined {
  return raw.setting === 'in_person' || raw.setting === 'virtual' ? raw.setting : undefined
}

/**
 * Sanity leaves country unset for a US event (the state implies it), while the
 * column always holds one. So a US row with no CMS country answers unset, as Sanity does.
 */
function countryOf(row: TenantEventRow, raw: Record<string, unknown>): string | undefined {
  const fromRaw = str(raw.country)
  if (fromRaw) return fromRaw
  return row.country && row.country !== 'US' ? row.country : undefined
}

/** A mirror row in getEventBySlug's shape. Pure. */
export function toEventDetail(row: TenantEventRow): TenantEventDetail {
  const raw = rawOf(row)
  const status = row.status && STATUSES.has(row.status) ? (row.status as StellarEvent['status']) : undefined
  const season = raw.season === 'fall' || raw.season === 'spring' ? raw.season : undefined
  return defined<TenantEventDetail>({
    _id: row.sanity_id,
    title: row.title,
    slug: { current: row.slug },
    type: str(raw.type),
    gradeLevel: str(raw.gradeLevel),
    gradeMin: num(raw.gradeMin),
    gradeMax: num(raw.gradeMax),
    ...eventDays(row, raw),
    activityType: activityTypeOf(row),
    setting: settingOf(raw),
    season,
    campaignYear: num(raw.campaignYear),
    deadline: str(raw.deadline),
    venue: str(raw.venue),
    city: str(raw.city),
    state: str(raw.state),
    registrationOpen: bool(raw.registrationOpen),
    registrationOpenDate: str(raw.registrationOpenDate),
    registrationCloseDate: str(raw.registrationCloseDate),
    capacity: num(raw.capacity),
    country: countryOf(row, raw),
    startTime: str(raw.startTime),
    endTime: str(raw.endTime),
    status,
  })
}

/** A mirror row in getEventsBySlugs' shape. Pure. */
export function toEventMeta(row: TenantEventRow): TenantEventMeta {
  const raw = rawOf(row)
  const { date, endDate } = eventDays(row, raw)
  return defined<TenantEventMeta>({
    _id: row.sanity_id,
    title: row.title,
    slug: { current: row.slug },
    activityType: activityTypeOf(row),
    date,
    endDate,
    setting: settingOf(raw),
  })
}

/** A mirror row in getEventsByIds' shape. Pure. */
export function toEventIdMeta(row: TenantEventRow): TenantEventIdMeta {
  const { date } = eventDays(row, rawOf(row))
  return defined<TenantEventIdMeta>({
    _id: row.sanity_id,
    title: row.title,
    slug: { current: row.slug },
    activityType: activityTypeOf(row),
    date,
  })
}

// ── Reads ────────────────────────────────────────────────────────────────────

function cleanList(values: string[]): string[] {
  if (!Array.isArray(values)) return []
  return [...new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0))]
}

/** Rows of `tenantId` whose `column` is one of `values`, in chunks. A read error throws. */
async function rowsIn(db: SupabaseClient, tenantId: string, column: 'slug' | 'sanity_id', values: string[]): Promise<TenantEventRow[]> {
  const out: TenantEventRow[] = []
  for (let i = 0; i < values.length; i += IN_CHUNK) {
    const chunk = values.slice(i, i + IN_CHUNK)
    const { data, error } = await db.from('events').select(TENANT_EVENT_COLUMNS).eq('tenant_id', tenantId).in(column, chunk)
    if (error) throw new Error(`events facade read failed: ${error.message}`)
    for (const row of (data ?? []) as TenantEventRow[]) if (row.tenant_id === tenantId) out.push(row)
  }
  return out
}

/**
 * One event by slug, within `tenantId` only, in getEventBySlug's shape (less
 * MIRROR_DETAIL_GAPS). Null when the tenant has no event with that slug, even if
 * another tenant does.
 */
export async function getEventBySlugForTenant(db: SupabaseClient, tenantId: string, slug: string): Promise<TenantEventDetail | null> {
  const tenant = requireTenantId(tenantId)
  if (typeof slug !== 'string' || !slug) return null
  const { data, error } = await db
    .from('events')
    .select(TENANT_EVENT_COLUMNS)
    .eq('tenant_id', tenant)
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw new Error(`events facade read failed: ${error.message}`)
  const row = (data as TenantEventRow | null) ?? null
  if (!row || row.tenant_id !== tenant) return null
  return toEventDetail(row)
}

/** Minimal metadata for a set of slugs, within `tenantId` only, in getEventsBySlugs' shape. */
export async function getEventsBySlugsForTenant(db: SupabaseClient, tenantId: string, slugs: string[]): Promise<TenantEventMeta[]> {
  const tenant = requireTenantId(tenantId)
  const list = cleanList(slugs)
  if (list.length === 0) return []
  return (await rowsIn(db, tenant, 'slug', list)).map(toEventMeta)
}

/**
 * Minimal metadata for a set of CMS document ids (the mirror's sanity_id), within
 * `tenantId` only, in getEventsByIds' shape.
 */
export async function getEventsByIdsForTenant(db: SupabaseClient, tenantId: string, ids: string[]): Promise<TenantEventIdMeta[]> {
  const tenant = requireTenantId(tenantId)
  const list = cleanList(ids)
  if (list.length === 0) return []
  return (await rowsIn(db, tenant, 'sanity_id', list)).map(toEventIdMeta)
}
