// Which artwork set an event prints on. Certificates, name badges and the
// educator PD certificate each have a default per competition theme, and an
// event's own upload overrides it (lib/artwork-defaults.ts). Pure: imported by
// client components and route handlers alike.

export type ArtworkTheme = 'space' | 'environmental'

export const ARTWORK_THEMES: readonly ArtworkTheme[] = ['space', 'environmental']

export const ARTWORK_THEME_LABEL: Record<ArtworkTheme, string> = {
  space: 'Space',
  environmental: 'Environmental',
}

export function isArtworkTheme(v: unknown): v is ArtworkTheme {
  return v === 'space' || v === 'environmental'
}

/**
 * A Sanity event type, a credential's theme or an event slug → the artwork set
 * it uses. The same rule as themeFromType (lib/campaigns.ts), so it agrees with
 * the theme a credential was issued with; anything else is Space.
 */
export function artworkTheme(v: unknown): ArtworkTheme {
  return typeof v === 'string' && v.toLowerCase().includes('environ') ? 'environmental' : 'space'
}
