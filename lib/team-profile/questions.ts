// The team profile question set (7 Oct 2026, approved by David).
//
// Replaces the per-event Google Form ("More Student Info"). Name, school, age,
// gender, ethnicity and previous participation are NOT asked: the registration
// already holds them, and the balancing algorithm reads them from there.
//
// Pure — safe to import from client components. Changing a question's meaning
// means a new DEFINITION_VERSION; rows record the version they were answered
// against, so history stays readable.

export const DEFINITION_VERSION = 1

export const RATING_LEVELS = [
  { key: 'beginner', label: 'Beginner', value: 0 },
  { key: 'intermediate', label: 'Intermediate', value: 1 },
  { key: 'advanced', label: 'Advanced', value: 2 },
] as const
export type RatingKey = (typeof RATING_LEVELS)[number]['key']

export const SKILL_AREAS = [
  { key: 'art', label: 'Art & graphic design' },
  { key: 'writing', label: 'Writing' },
  { key: 'presenting', label: 'Speaking & presenting' },
  { key: 'science_maths', label: 'Science & maths' },
  { key: 'engineering', label: 'Engineering & tech (CAD, coding, building things)' },
  { key: 'leadership', label: 'Leadership' },
] as const
export type SkillAreaKey = (typeof SKILL_AREAS)[number]['key']

/** The ten STEM soft skills used for both "strengths" and "areas to work on". */
export const SOFT_SKILLS = [
  { key: 'problem_solving', label: 'Problem solving' },
  { key: 'critical_thinking', label: 'Critical thinking' },
  { key: 'creativity', label: 'Creativity & new ideas' },
  { key: 'teamwork', label: 'Teamwork & collaboration' },
  { key: 'communication', label: 'Communication' },
  { key: 'attention_to_detail', label: 'Attention to detail' },
  { key: 'time_management', label: 'Time management & organization' },
  { key: 'adaptability', label: 'Adapting when plans change' },
  { key: 'curiosity', label: 'Curiosity & research' },
  { key: 'resilience', label: 'Sticking with hard problems' },
] as const
export type SoftSkillKey = (typeof SOFT_SKILLS)[number]['key']

export const FOCUS_AREAS = [
  { key: 'design', label: 'Design & graphics' },
  { key: 'engineering', label: 'Engineering & technical' },
  { key: 'science', label: 'Science & research' },
  { key: 'business', label: 'Business & budgeting' },
  { key: 'communication', label: 'Presenting & communication' },
  { key: 'not_sure', label: 'Not sure yet' },
] as const

export const TEAM_STYLES = [
  { key: 'take_charge', label: 'Taking charge' },
  { key: 'ideas', label: 'Coming up with ideas' },
  { key: 'details', label: 'Getting the details right' },
  { key: 'on_track', label: 'Keeping everyone on track' },
  { key: 'presenting', label: 'Presenting to others' },
] as const

export const LEADERSHIP_INTEREST = [
  { key: 'yes', label: 'Yes, I’d love to' },
  { key: 'maybe', label: 'Maybe, if needed' },
  { key: 'no', label: 'I’d rather focus on my own part' },
] as const

export const OTHER_COMPETITIONS = [
  { key: 'robotics', label: 'Robotics' },
  { key: 'science_fair', label: 'Science fair' },
  { key: 'model_un', label: 'Model UN or debate' },
  { key: 'hackathon', label: 'Hackathon or coding' },
  { key: 'other', label: 'Other' },
  { key: 'none', label: 'None yet' },
] as const

export interface TeamProfileAnswers {
  skills: Partial<Record<SkillAreaKey, RatingKey>>
  strengths: SoftSkillKey[]
  weaknesses: SoftSkillKey[]
  focus: string | null
  teamStyle: string | null
  leadership: string | null
  /** 1 (not at all) … 5 (very comfortable). */
  presentingComfort: number | null
  competitions: string[]
  competitionsOther: string
  /** Up to two names, as typed. */
  teammates: string[]
  notes: string
}

export const EMPTY_ANSWERS: TeamProfileAnswers = {
  skills: {},
  strengths: [],
  weaknesses: [],
  focus: null,
  teamStyle: null,
  leadership: null,
  presentingComfort: null,
  competitions: [],
  competitionsOther: '',
  teammates: [],
  notes: '',
}

export const MAX_TEAMMATES = 2
export const MAX_NAME_CHARS = 80
export const MAX_NOTES_CHARS = 1000
export const MAX_OTHER_CHARS = 200

const keysOf = <T extends readonly { key: string }[]>(list: T) => new Set(list.map((o) => o.key))
const SKILL_KEYS = keysOf(SKILL_AREAS)
const RATING_KEYS = keysOf(RATING_LEVELS)
const SOFT_KEYS = keysOf(SOFT_SKILLS)
const FOCUS_KEYS = keysOf(FOCUS_AREAS)
const STYLE_KEYS = keysOf(TEAM_STYLES)
const LEAD_KEYS = keysOf(LEADERSHIP_INTEREST)
const COMP_KEYS = keysOf(OTHER_COMPETITIONS)

const clean = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : ''

/**
 * Coerce stored or submitted JSON into answers, dropping anything unknown.
 * Never throws: an old or tampered row reads as whatever is still valid.
 */
export function normaliseAnswers(raw: unknown): TeamProfileAnswers {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const skills: TeamProfileAnswers['skills'] = {}
  const rawSkills = (r.skills && typeof r.skills === 'object' ? r.skills : {}) as Record<string, unknown>
  for (const [k, v] of Object.entries(rawSkills)) {
    if (SKILL_KEYS.has(k) && typeof v === 'string' && RATING_KEYS.has(v)) skills[k as SkillAreaKey] = v as RatingKey
  }
  const list = (v: unknown, allowed: Set<string>) =>
    [...new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && allowed.has(x)) : [])]
  const pick = (v: unknown, allowed: Set<string>) => (typeof v === 'string' && allowed.has(v) ? v : null)

  const strengths = list(r.strengths, SOFT_KEYS) as SoftSkillKey[]
  // A skill can't be both: the strength wins.
  const weaknesses = (list(r.weaknesses, SOFT_KEYS) as SoftSkillKey[]).filter((k) => !strengths.includes(k))
  let competitions = list(r.competitions, COMP_KEYS)
  if (competitions.includes('none')) competitions = ['none']
  const comfort = Number(r.presentingComfort)

  return {
    skills,
    strengths,
    weaknesses,
    focus: pick(r.focus, FOCUS_KEYS),
    teamStyle: pick(r.teamStyle, STYLE_KEYS),
    leadership: pick(r.leadership, LEAD_KEYS),
    presentingComfort: Number.isInteger(comfort) && comfort >= 1 && comfort <= 5 ? comfort : null,
    competitions,
    competitionsOther: competitions.includes('other') ? clean(r.competitionsOther, MAX_OTHER_CHARS) : '',
    teammates: (Array.isArray(r.teammates) ? r.teammates : [])
      .map((n) => clean(n, MAX_NAME_CHARS))
      .filter(Boolean)
      .slice(0, MAX_TEAMMATES),
    notes: clean(r.notes, MAX_NOTES_CHARS),
  }
}

/** What is still missing before the form can be submitted (empty = complete). */
export function missingAnswers(a: TeamProfileAnswers): string[] {
  const missing: string[] = []
  for (const s of SKILL_AREAS) if (!a.skills[s.key]) missing.push(`skills.${s.key}`)
  if (a.strengths.length === 0) missing.push('strengths')
  if (!a.focus) missing.push('focus')
  if (!a.teamStyle) missing.push('teamStyle')
  if (!a.leadership) missing.push('leadership')
  if (a.presentingComfort === null) missing.push('presentingComfort')
  if (a.competitions.length === 0) missing.push('competitions')
  return missing
}

export const labelOf = (list: readonly { key: string; label: string }[], key: string | null | undefined) =>
  list.find((o) => o.key === key)?.label ?? ''
