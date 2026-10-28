// ── Future history ───────────────────────────────────────────────────────────
// Every competition is set in a forecast future. Space competitions rotate
// through four parts of the solar system, one per school year, each set further
// ahead than the last (David, 27 Oct 2026):
//
//   cislunar space  +20 years   →  Mars  +25  →  inner system  +30  →  outer  +35
//
// The 2026 series was cislunar; the 2027 series is Mars, set in 2052 (the 2027
// Mission Handbook: "It is 2052."). Environmental competitions run alongside
// every year, on Earth, in the same year as that school year's space
// competition.
//
// Pure: no I/O, so the page, the teaser and the tests all agree.

/** The school year the site describes. The 2026/27 school year is 2027. */
export const CURRENT_SCHOOL_YEAR = 2027

/** The first school year of the rotation — the cislunar year. */
const CYCLE_START_SCHOOL_YEAR = 2026

export type SpaceEraId = 'cislunar' | 'mars' | 'inner' | 'outer'

export interface SpaceEra {
  id: SpaceEraId
  name: string
  /** What the region covers, in plain words. */
  scope: string
  /** How far beyond the school year the story is set. */
  yearsAhead: number
  /** One sentence on what the environment does to a design there. */
  designDrivers: string
}

export const SPACE_ERAS: readonly SpaceEra[] = [
  {
    id: 'cislunar', name: 'Cislunar space', scope: 'Earth orbit and the Moon', yearsAhead: 20,
    designDrivers: 'Vacuum, radiation, two-week lunar nights and abrasive dust all shape the design.',
  },
  {
    id: 'mars', name: 'Mars', scope: 'Mars and its moons, Phobos and Deimos', yearsAhead: 25,
    designDrivers: 'Low gravity, fine dust, radiation and launch windows 26 months apart all shape the design.',
  },
  {
    id: 'inner', name: 'The inner solar system', scope: 'Mercury and Venus', yearsAhead: 30,
    designDrivers: 'Crushing pressure, acid clouds and extreme heat all shape the design.',
  },
  {
    id: 'outer', name: 'The outer solar system', scope: 'The asteroid belt and the gas giants', yearsAhead: 35,
    designDrivers: 'Distance, deep cold, radiation belts and long communication delays all shape the design.',
  },
]

/** A region or name mid-sentence: "The outer solar system" → "the outer solar system". */
export function inSentence(text: string): string {
  return text.replace(/^The /, 'the ')
}

/** The part of the solar system a school year's space competitions are set in. */
export function eraForSchoolYear(schoolYear: number): SpaceEra {
  const i = (((schoolYear - CYCLE_START_SCHOOL_YEAR) % SPACE_ERAS.length) + SPACE_ERAS.length) % SPACE_ERAS.length
  return SPACE_ERAS[i]
}

/** The year a school year's competitions are set in — space and environmental alike. */
export function storyYear(schoolYear: number): number {
  return schoolYear + eraForSchoolYear(schoolYear).yearsAhead
}

export interface EraInCycle {
  era: SpaceEra
  /** This era's next school year, from `from` onward. */
  schoolYear: number
  /** The year that school year's story is set in. */
  setIn: number
  current: boolean
}

/** The four eras in rotation order, each with its next school year from `from`. */
export function eraCycle(from: number = CURRENT_SCHOOL_YEAR): EraInCycle[] {
  return SPACE_ERAS.map((era) => {
    let schoolYear = from
    while (eraForSchoolYear(schoolYear).id !== era.id) schoolYear += 1
    return { era, schoolYear, setIn: schoolYear + era.yearsAhead, current: schoolYear === from }
  })
}
