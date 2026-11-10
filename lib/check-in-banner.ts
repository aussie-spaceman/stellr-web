import type { SupabaseClient } from '@supabase/supabase-js'
import { getEventsBySlugs } from '@/lib/events/repo'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// ── The check-in banner: one QR code for every event ─────────────────────────
//
// Oct 2026: staff take one printed banner from event to event. Its QR code is
// the fixed address /check-in, which sends the phone on to whichever in-person
// event has check-in open (the desk console's Open check-in switch). Opening one
// in-person event's check-in closes the others the caller manages (admin
// check-in route; an admin manages them all), so normally exactly one is open.
// Virtual events are left out: their attendance link is emailed, and the banner
// never stands at one.

export const CHECK_IN_BANNER_PATH = '/check-in'

export interface OpenCheckIn {
  slug: string
  token: string | null
  title: string | null
  date: string | null
  endDate: string | null
  /** False for a virtual event, and for a slug with no Sanity event behind it. */
  inPerson: boolean
}

const DAY_MS = 86_400_000

/** Days between `today` and the event, 0 while it is on. Undated events sort last. */
function daysAway(e: OpenCheckIn, today: string): number {
  const start = Date.parse(e.date?.slice(0, 10) ?? '')
  if (Number.isNaN(start)) return Infinity
  const endParsed = Date.parse(e.endDate?.slice(0, 10) ?? '')
  const end = Number.isNaN(endParsed) ? start : endParsed
  const t = Date.parse(today)
  if (t < start) return (start - t) / DAY_MS
  if (t > end) return (t - end) / DAY_MS
  return 0
}

/**
 * The event a banner scan goes to, or null when no in-person check-in is open.
 * Two can be open at once — an event manager opening theirs leaves an event
 * they don't run alone — so the event nearest `today` (YYYY-MM-DD) wins, and
 * the banner still lands somewhere sensible.
 */
export function pickBannerEvent(open: OpenCheckIn[], today: string): OpenCheckIn | null {
  const usable = open.filter((e) => e.inPerson && e.token)
  if (usable.length === 0) return null
  return [...usable].sort((a, b) => daysAway(a, today) - daysAway(b, today) || a.slug.localeCompare(b.slug))[0]
}

/** Who is asking: lib/event-access's answer for an allowed caller. */
export interface CheckInViewer {
  isAdmin: boolean
  /** The events an event manager is assigned to; null for a full admin. */
  assignedSlugs: string[] | null
}

/**
 * Whether `viewer` may see, or close, check-in for `slug`. A full admin sees
 * every event; an event manager only the events they are assigned to. Anything
 * short of `isAdmin: true` counts as an event manager, so a malformed viewer
 * (no assignment list) sees nothing extra.
 */
export function canSeeCheckIn(viewer: CheckInViewer, slug: string): boolean {
  if (viewer.isAdmin === true) return true
  return (viewer.assignedSlugs ?? []).includes(slug)
}

/**
 * The open check-ins `viewer` may see. S0 (Nov 2026): the desk and the banner
 * page listed every open event, and opening one closed all the others, for any
 * event manager — who could see and shut check-in at events they don't run.
 */
export function checkInsVisibleTo(open: OpenCheckIn[], viewer: CheckInViewer): OpenCheckIn[] {
  return open.filter((e) => canSeeCheckIn(viewer, e.slug))
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

const openSettings = (db: SupabaseClient) => db.from('event_settings').select('event_slug, check_in_token').eq('check_in_open', true)

type SettingRows = { data: { event_slug: unknown; check_in_token: unknown }[] | null; error: { message: string } | null }

/**
 * Every Stellr event with check-in switched on, with its title, dates and setting from
 * Sanity, for Stellr's banner and desk. Other organisers' open check-ins stay out of it:
 * a NULL tenant_id is a Stellr row the backfill hasn't reached, and every row is one or
 * the other until a second tenant has an event, so today this returns every open row.
 */
export async function loadOpenCheckIns(db: SupabaseClient): Promise<OpenCheckIn[]> {
  return withEventDetails(await openSettings(db).or(`tenant_id.is.null,tenant_id.eq.${STELLR_TENANT_ID}`))
}

/**
 * One tenant's open check-ins: a tenant page's banner must not send a phone to another
 * organiser's event. An empty id throws, rather than reading everyone's.
 */
export async function loadOpenCheckInsForTenant(db: SupabaseClient, tenantId: string): Promise<OpenCheckIn[]> {
  if (!tenantId) throw new Error('Failed to load open check-ins: no tenant id')
  return withEventDetails(await openSettings(db).eq('tenant_id', tenantId))
}

async function withEventDetails({ data: rows, error }: SettingRows): Promise<OpenCheckIn[]> {
  if (error) throw new Error(`Failed to load open check-ins: ${error.message}`)
  if (!rows?.length) return []

  const events = await getEventsBySlugs(rows.map((r) => r.event_slug as string))
  const bySlug = new Map(events.map((e) => [e.slug.current, e]))
  return rows.map((r) => {
    const e = bySlug.get(r.event_slug as string)
    return {
      slug: r.event_slug as string,
      token: (r.check_in_token as string | null) ?? null,
      title: e?.title ?? null,
      date: e?.date ?? null,
      endDate: e?.endDate ?? null,
      inPerson: Boolean(e) && e?.setting !== 'virtual',
    }
  })
}
