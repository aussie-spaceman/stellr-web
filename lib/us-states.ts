// deep review QUAL-12: US-state normalisation with no imports.
//
// `normaliseState` lived in lib/locations, which value-imports the Sanity client
// (`lib/sanity`) for its map queries. lib/survey/timezone imports normaliseState,
// and the client `EventSurveyPanel` imports timezone — so the Sanity client was
// being dragged into that admin bundle for a pure string lookup. Keeping the
// lookup here, dependency-free, lets timezone (and any client that needs it)
// import it without the client. lib/locations re-exports it for its own callers.

/* Sanity's `state` field is free text and the dataset proves it: "Colorado",
 * "CO", "NV", "South Dakota" and "Departamento de Maldonado" all coexist. A
 * distinct-state count over raw strings would report Colorado twice, so
 * normalise first — and use the same map to decide what counts as US at all. */
export const US_STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC',
}
export const US_CODES = new Set(Object.values(US_STATES))

/** USPS code for a US state written either way, else undefined (⇒ not US). */
export function normaliseState(raw?: string): string | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (trimmed.length === 2 && US_CODES.has(trimmed.toUpperCase())) return trimmed.toUpperCase()
  return US_STATES[trimmed.toLowerCase()]
}

/** Full state name for a USPS code ("CO" → "Colorado"), else undefined. */
export function stateNameFor(code?: string): string | undefined {
  const upper = code?.trim().toUpperCase()
  if (!upper) return undefined
  const name = Object.keys(US_STATES).find((key) => US_STATES[key] === upper)
  if (!name) return undefined
  // "district of columbia" → "District of Columbia": title case, joiners kept lower.
  return name
    .split(' ')
    .map((word, i) => (i > 0 && word === 'of' ? word : word[0].toUpperCase() + word.slice(1)))
    .join(' ')
}
