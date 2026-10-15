import type { SupabaseClient } from '@supabase/supabase-js'
import { getEventsBySlugs } from '@/lib/sanity'

// ── The check-in banner: one QR code for every event ─────────────────────────
//
// Oct 2026: staff take one printed banner from event to event. Its QR code is
// the fixed address /check-in, which sends the phone on to whichever in-person
// event has check-in open (the desk console's Open check-in switch). Opening one
// in-person event's check-in closes the others (admin check-in route), so
// normally exactly one is open. Virtual events are left out: their attendance
// link is emailed, and the banner never stands at one.

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
 * Two open at once is a mistake the admin route prevents; if it happens anyway,
 * the event nearest `today` (YYYY-MM-DD) wins, so the banner still lands
 * somewhere sensible.
 */
export function pickBannerEvent(open: OpenCheckIn[], today: string): OpenCheckIn | null {
  const usable = open.filter((e) => e.inPerson && e.token)
  if (usable.length === 0) return null
  return [...usable].sort((a, b) => daysAway(a, today) - daysAway(b, today) || a.slug.localeCompare(b.slug))[0]
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Every event with check-in switched on, with its title, dates and setting from Sanity. */
export async function loadOpenCheckIns(db: SupabaseClient): Promise<OpenCheckIn[]> {
  const { data: rows, error } = await db.from('event_settings').select('event_slug, check_in_token').eq('check_in_open', true)
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
