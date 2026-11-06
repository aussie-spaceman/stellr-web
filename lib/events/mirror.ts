/**
 * The Postgres events mirror, read side (multi-tenancy plan S3). Split from the
 * facade (lib/events/repo.ts) so that a plain event read has no path, static or
 * by import, to a database write or a database client.
 *
 * The caller brings the client, and the tenant on any path that can write. Nothing
 * here decides that a miss belongs to Stellr: a miss is what an unmirrored tenant
 * event looks like, and a row written with the wrong owner would pass as that owner
 * in the registration checks. So a sync on a miss happens only for a named tenant.
 *
 *   • getEventBySlugMirrored reads the event from Sanity and, after the response
 *     (runAfterResponse), makes sure the mirror holds it. It is never awaited, so
 *     a slow or failing mirror cannot delay or fail the caller. Nothing on the live
 *     registration path calls it yet.
 *   • getMirroredEvent reads the mirror itself. It awaits the database, so it is for
 *     admin screens, scripts and background work only, never the registration path.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { runAfterResponse } from '@/lib/after-response'
import { getEventBySlug } from './repo'
import { syncEventFromSanity, type EventFetcher, type TenantDefaults } from './sync'

/**
 * getEventBySlug, plus a background check that the mirror holds the event. Separate
 * from it because the audit gate follows calls (lib/security/audit-coverage.ts), and
 * would otherwise count every GET that reads an event as a GET that writes.
 *
 * `tenant` is the event's resolved owner. Do not call this for an event whose owner
 * is not known yet.
 */
export async function getEventBySlugMirrored(slug: string, opts: { db: SupabaseClient; tenant: TenantDefaults; fetcher?: EventFetcher }) {
  const event = await getEventBySlug(slug)
  if (event) ensureEventMirrored(slug, opts)
  return event
}

export interface MirroredEvent {
  id: string
  tenant_id: string
  slug: string
  sanity_id: string
  title: string
  activity_type: string
  starts_at: string | null
  ends_at: string | null
  time_zone: string
  country: string
  currency: string
  grade_system: string
  min_participant_age: number | null
  status: string | null
  synced_at: string
}

const MIRROR_COLUMNS =
  'id, tenant_id, slug, sanity_id, title, activity_type, starts_at, ends_at, time_zone, country, currency, grade_system, min_participant_age, status, synced_at'

/**
 * The mirror's row for `slug`, or null; a read error throws. With `syncOnMissFor`, a
 * miss re-reads the event from Sanity, writes it for that tenant, and returns the
 * new row. Admin / background use only: this awaits the database.
 */
export async function getMirroredEvent(
  slug: string,
  opts: { db: SupabaseClient; syncOnMissFor?: TenantDefaults; fetcher?: EventFetcher },
): Promise<MirroredEvent | null> {
  const { db } = opts
  const read = async () => {
    const { data, error } = await db.from('events').select(MIRROR_COLUMNS).eq('slug', slug).maybeSingle()
    if (error) throw new Error(`events mirror read failed: ${error.message}`)
    return (data as MirroredEvent | null) ?? null
  }
  const hit = await read()
  if (hit || !opts.syncOnMissFor) return hit
  const result = await syncEventFromSanity(db, { slug }, { fetcher: opts.fetcher, tenant: opts.syncOnMissFor })
  return result.status === 'synced' ? read() : null
}

/**
 * Fire-and-forget: after the response, check the mirror for `slug` and sync it from
 * Sanity for `tenant` on a miss. Returns immediately; never throws.
 */
export function ensureEventMirrored(slug: string, opts: { db: SupabaseClient; tenant: TenantDefaults; fetcher?: EventFetcher }): void {
  if (!slug) return
  runAfterResponse('events-mirror', async () => {
    await getMirroredEvent(slug, { db: opts.db, syncOnMissFor: opts.tenant, fetcher: opts.fetcher })
  })
}
