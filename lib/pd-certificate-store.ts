import type { SupabaseClient } from '@supabase/supabase-js'
import { RESOURCES_BUCKET } from '@/lib/community'
import { downloadArtwork } from '@/lib/event-certificates'
import { DEFAULT_PD_LAYOUT, parsePdLayout, type PdArtwork, type PdLayout } from '@/lib/pd-certificate'

// Where the PD certificate lives: per competition theme (space / environmental),
// two artwork pages and the field layout, at fixed paths in the
// community-resources bucket. One design per theme, shared by every event of
// that theme — so there is no table; the files are the record. A theme with no
// front uploaded prints the plain certificate, never another theme's design.
// Design: docs/PLAN-educator-pd-2026-10-07.md §8.

export type PdPage = 'front' | 'back'
export type PdTheme = 'space' | 'environmental'

export const pdArtworkPath = (theme: PdTheme, page: PdPage) => `pd-certificate/${theme}/${page}`
export const pdLayoutPath = (theme: PdTheme) => `pd-certificate/${theme}/layout.json`

export function isPdPage(v: unknown): v is PdPage {
  return v === 'front' || v === 'back'
}

/** Any credential/event theme → the artwork set it prints on. */
export function pdTheme(v: unknown): PdTheme {
  return v === 'environmental' ? 'environmental' : 'space'
}

export async function loadPdArtwork(db: SupabaseClient, theme: PdTheme): Promise<PdArtwork> {
  const [front, back] = await Promise.all([
    downloadArtwork(db, pdArtworkPath(theme, 'front')),
    downloadArtwork(db, pdArtworkPath(theme, 'back')),
  ])
  return { front, back }
}

/** The saved layout, or the mock-up defaults when none is saved (or it is unreadable). */
export async function loadPdLayout(db: SupabaseClient, theme: PdTheme): Promise<PdLayout> {
  const { data } = await db.storage.from(RESOURCES_BUCKET).download(pdLayoutPath(theme))
  if (!data) return DEFAULT_PD_LAYOUT
  try {
    return parsePdLayout(JSON.parse(await data.text())) ?? DEFAULT_PD_LAYOUT
  } catch {
    return DEFAULT_PD_LAYOUT
  }
}

export async function savePdLayout(db: SupabaseClient, theme: PdTheme, layout: PdLayout): Promise<string | null> {
  const { error } = await db.storage
    .from(RESOURCES_BUCKET)
    .upload(pdLayoutPath(theme), new TextEncoder().encode(JSON.stringify(layout)), { upsert: true, contentType: 'application/json' })
  return error ? error.message : null
}

/** Which pages exist and when they changed, for the admin panel. */
export async function pdArtworkStatus(db: SupabaseClient, theme: PdTheme): Promise<Record<PdPage, string | null>> {
  const { data } = await db.storage.from(RESOURCES_BUCKET).list(`pd-certificate/${theme}`)
  const updated = (name: string) => (data ?? []).find((f) => f.name === name)?.updated_at ?? null
  return { front: updated('front'), back: updated('back') }
}
