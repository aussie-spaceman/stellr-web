// Single source of truth for the section colour identity (wayfinding).
// Apply consistently in nav, headers, cards, and badges.
//   Competitions → orange  Community → blue  Academy → gold
// `tw` is the brand-* Tailwind token suffix; `text` is the contrast-safe text
// colour (gold uses gold-ink when set on white).

// Hex values mirror the V2 token resolution of each `tw` alias; `text` uses a
// deeper, contrast-safe shade for use on white.
export const SECTION = {
  competitions: { fill: '#E0922F', text: '#C2722A', tw: 'orange-alt' }, // pathway amber
  community:    { fill: '#3C6DF6', text: '#2C53C6', tw: 'blue' },        // primary
  academy:      { fill: '#E0A23A', text: '#C2722A', tw: 'orange' },      // donate gold
} as const

export type SectionKey = keyof typeof SECTION
