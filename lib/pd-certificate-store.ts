import type { SupabaseClient } from '@supabase/supabase-js'
import { RESOURCES_BUCKET } from '@/lib/community'
import { downloadArtwork } from '@/lib/event-certificates'
import { DEFAULT_PD_LAYOUT, parsePdLayout, type PdArtwork, type PdLayout } from '@/lib/pd-certificate'
import { eventsIssuedOn } from '@/lib/artwork-defaults'
import { artworkTheme, type ArtworkTheme } from '@/lib/artwork-theme'

// Where the PD certificate lives: two artwork pages and the field layout, at
// fixed paths in the community-resources bucket — so there is no table; the
// files are the record.
//   pd-certificate/<theme>/…         the default for every event of that
//                                    competition theme (space / environmental)
//   pd-certificate/events/<slug>/…   one event's own pages (30 Oct 2026),
//                                    each page overriding the theme's
// A page with neither prints the plain certificate, never another theme's
// design. Design: docs/PLAN-educator-pd-2026-10-07.md §8.

export type PdPage = 'front' | 'back'
export type PdTheme = ArtworkTheme

/** A theme's default, or (with `event`) that event's own files. */
export interface PdScope {
  theme: PdTheme
  event?: string | null
}

const folder = (s: PdScope) => (s.event ? `pd-certificate/events/${s.event}` : `pd-certificate/${s.theme}`)
export const pdArtworkPath = (s: PdScope, page: PdPage) => `${folder(s)}/${page}`
export const pdLayoutPath = (s: PdScope) => `${folder(s)}/layout.json`

export function isPdPage(v: unknown): v is PdPage {
  return v === 'front' || v === 'back'
}

/** Any credential/event theme → the artwork set it prints on. */
export const pdTheme = artworkTheme

/** Each page: the event's own (when `event` is given), else the theme's. */
export async function loadPdArtwork(db: SupabaseClient, theme: PdTheme, event?: string | null): Promise<PdArtwork> {
  const page = async (p: PdPage) =>
    (event ? await downloadArtwork(db, pdArtworkPath({ theme, event }, p)) : null) ??
    (await downloadArtwork(db, pdArtworkPath({ theme }, p)))
  const [front, back] = await Promise.all([page('front'), page('back')])
  return { front, back }
}

async function readLayout(db: SupabaseClient, s: PdScope): Promise<PdLayout | null> {
  const { data } = await db.storage.from(RESOURCES_BUCKET).download(pdLayoutPath(s))
  if (!data) return null
  try {
    return parsePdLayout(JSON.parse(await data.text()))
  } catch {
    return null
  }
}

/**
 * The saved layout — the event's own (when `event` is given), else the
 * theme's — or the mock-up defaults when none is saved (or it is unreadable).
 */
export async function loadPdLayout(db: SupabaseClient, theme: PdTheme, event?: string | null): Promise<PdLayout> {
  return (event ? await readLayout(db, { theme, event }) : null) ?? (await readLayout(db, { theme })) ?? DEFAULT_PD_LAYOUT
}

export async function savePdLayout(db: SupabaseClient, s: PdScope, layout: PdLayout): Promise<string | null> {
  const { error } = await db.storage
    .from(RESOURCES_BUCKET)
    .upload(pdLayoutPath(s), new TextEncoder().encode(JSON.stringify(layout)), { upsert: true, contentType: 'application/json' })
  return error ? error.message : null
}

/** Which files exist and when they changed, for the admin panel. */
export async function pdArtworkStatus(db: SupabaseClient, s: PdScope): Promise<Record<PdPage | 'layout', string | null>> {
  const { data } = await db.storage.from(RESOURCES_BUCKET).list(folder(s))
  const updated = (name: string) => (data ?? []).find((f) => f.name === name)?.updated_at ?? null
  return { front: updated('front'), back: updated('back'), layout: updated('layout.json') }
}

/**
 * Drop one of an event's own pages, so it prints the theme's again. The
 * layout goes with the front: it was set for that artwork.
 */
export async function removePdEventPage(db: SupabaseClient, s: PdScope & { event: string }, page: PdPage): Promise<string | null> {
  const paths = page === 'front' ? [pdArtworkPath(s, 'front'), pdLayoutPath(s)] : [pdArtworkPath(s, 'back')]
  const { error } = await db.storage.from(RESOURCES_BUCKET).remove(paths)
  return error ? error.message : null
}

/**
 * Before a theme's default page is replaced: every event that has issued PD
 * certificates on it gets its own copy (with the front, the layout set for it),
 * so a teacher's download keeps printing what they were issued. Events with
 * their own page keep it. Returns how many events were pinned.
 */
export async function pinDefaultPdPage(db: SupabaseClient, theme: PdTheme, page: PdPage): Promise<number> {
  const theirs = await pdArtworkStatus(db, { theme })
  if (!theirs[page]) return 0
  const bucket = db.storage.from(RESOURCES_BUCKET)
  let pinned = 0
  for (const event of await eventsIssuedOn(db, { source: 'pd', theme })) {
    const own = await pdArtworkStatus(db, { theme, event })
    if (own[page]) continue
    const { error } = await bucket.copy(pdArtworkPath({ theme }, page), pdArtworkPath({ theme, event }, page))
    if (error) throw new Error(`[pd-certificate] pin ${page} for ${event}: ${error.message}`)
    if (page === 'front' && theirs.layout && !own.layout) {
      const { error: layoutError } = await bucket.copy(pdLayoutPath({ theme }), pdLayoutPath({ theme, event }))
      if (layoutError) throw new Error(`[pd-certificate] pin layout for ${event}: ${layoutError.message}`)
    }
    pinned++
  }
  return pinned
}
