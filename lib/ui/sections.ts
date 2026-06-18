// Single source of truth for the section colour identity (wayfinding).
// Apply consistently in nav, headers, cards, and badges.
//   Competitions → orange  Community → blue  Academy → gold
// `tw` is the brand-* Tailwind token suffix; `text` is the contrast-safe text
// colour (gold uses gold-ink when set on white).

export const SECTION = {
  competitions: { fill: '#da6220', text: '#da6220', tw: 'orange-alt' },
  community:    { fill: '#0d439d', text: '#0d439d', tw: 'blue' },
  academy:      { fill: '#dda33b', text: '#b67a1e', tw: 'orange' },
} as const

export type SectionKey = keyof typeof SECTION
