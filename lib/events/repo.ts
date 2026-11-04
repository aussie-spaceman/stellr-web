/**
 * The events facade (multi-tenancy plan S3). One door for event reads, so S5
 * and S8 can move callers from Sanity to Postgres without touching each one.
 *
 * In S3 it changes NOTHING about how events are read:
 *   • getEventBySlug / getAllEvents / getEventsBySlugs / getEventsByIds return
 *     exactly what lib/sanity returns today — same query, same cache window.
 *   • `{ mirror: true }` additionally makes sure the Postgres mirror holds the
 *     event: a mirror miss schedules a sync AFTER the response
 *     (runAfterResponse). It is never awaited, so a slow or failing mirror
 *     cannot delay or fail the caller. Nothing on the live registration path
 *     passes it yet.
 *   • getMirroredEvent reads the mirror itself, syncing on a miss when asked.
 *     It awaits the database, so it is for admin screens, scripts and
 *     background work only — never the registration path.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getEventBySlug as sanityEventBySlug,
  getAllEvents as sanityAllEvents,
  getEventsBySlugs as sanityEventsBySlugs,
  getEventsByIds as sanityEventsByIds,
} from '@/lib/sanity'
import { supabaseServer } from '@/lib/supabase'
import { runAfterResponse } from '@/lib/after-response'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { syncEventFromSanity, type EventFetcher } from './sync'

export interface MirrorOption {
  /** Make sure the mirror holds the event, in the background. Default false. */
  mirror?: boolean
}

/** One event by slug, from Sanity exactly as lib/sanity returns it. */
export async function getEventBySlug(slug: string, opts: MirrorOption = {}) {
  const event = await sanityEventBySlug(slug)
  if (opts.mirror && event) ensureEventMirrored(slug)
  return event
}

/** Every live event, from Sanity (unchanged). */
export async function getAllEvents() {
  return sanityAllEvents()
}

/** Minimal metadata for a set of slugs, from Sanity (unchanged). */
export async function getEventsBySlugs(slugs: string[]) {
  return sanityEventsBySlugs(slugs)
}

/** Minimal metadata for a set of Sanity _ids, from Sanity (unchanged). */
export async function getEventsByIds(ids: string[]) {
  return sanityEventsByIds(ids)
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
 * The mirror's row for `slug`, or null. With `syncOnMiss`, a miss re-reads the
 * event from Sanity, writes it, and returns the new row. Admin / background
 * use only: this awaits the database.
 */
export async function getMirroredEvent(
  slug: string,
  opts: { db?: SupabaseClient; syncOnMiss?: boolean; fetcher?: EventFetcher } = {},
): Promise<MirroredEvent | null> {
  const db = opts.db ?? supabaseServer()
  const read = async () => {
    const { data, error } = await db.from('events').select(MIRROR_COLUMNS).eq('slug', slug).maybeSingle()
    if (error) throw new Error(`events mirror read failed: ${error.message}`)
    return (data as MirroredEvent | null) ?? null
  }
  const hit = await read()
  if (hit || !opts.syncOnMiss) return hit
  const result = await syncEventFromSanity(db, { slug }, { fetcher: opts.fetcher })
  return result.status === 'synced' ? read() : null
}

/**
 * The tenant that owns `slug`, from the mirror; Stellr when the mirror does
 * not have it (every event is Stellr's in S3). Admin / background use only.
 */
export async function getEventTenantId(slug: string, opts: { db?: SupabaseClient } = {}): Promise<string> {
  try {
    return (await getMirroredEvent(slug, { db: opts.db }))?.tenant_id ?? STELLR_TENANT_ID
  } catch {
    return STELLR_TENANT_ID
  }
}

/**
 * Fire-and-forget: after the response, check the mirror for `slug` and sync it
 * from Sanity on a miss. Returns immediately; never throws.
 */
export function ensureEventMirrored(slug: string, opts: { db?: SupabaseClient; fetcher?: EventFetcher } = {}): void {
  if (!slug) return
  runAfterResponse('events-mirror', async () => {
    await getMirroredEvent(slug, { db: opts.db, syncOnMiss: true, fetcher: opts.fetcher })
  })
}
