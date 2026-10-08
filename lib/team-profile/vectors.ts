// Team profile answers → the numbers lib/company-assign.ts balances. Pure.

import {
  FOCUS_AREAS,
  RATING_LEVELS,
  SKILL_AREAS,
  SOFT_SKILLS,
  TEAM_STYLES,
  type TeamProfileAnswers,
} from './questions'

const rating = (key: string | undefined) => RATING_LEVELS.find((r) => r.key === key)?.value

/**
 * One vector per student for "skill spread": the six self-ratings (0..1), the
 * ten soft skills (+1 strength, −1 area to work on), and the preferred focus
 * area and team style (one-hot), so each company gets a mix of all of them.
 * Leadership is left out here; it is its own, lower-priority factor.
 */
export function skillVector(a: TeamProfileAnswers): number[] {
  const out: number[] = []
  for (const s of SKILL_AREAS) {
    if (s.key === 'leadership') continue
    out.push((rating(a.skills[s.key]) ?? 1) / 2)
  }
  for (const s of SOFT_SKILLS) out.push(a.strengths.includes(s.key) ? 1 : a.weaknesses.includes(s.key) ? -1 : 0)
  for (const f of FOCUS_AREAS) if (f.key !== 'not_sure') out.push(a.focus === f.key ? 1 : 0)
  for (const t of TEAM_STYLES) out.push(a.teamStyle === t.key ? 1 : 0)
  return out
}

/** 0..1: wanting to lead, the leadership self-rating, and a "taking charge" style. */
export function leaderScore(a: TeamProfileAnswers): number | null {
  const parts: number[] = []
  const interest = { yes: 1, maybe: 0.5, no: 0 }[a.leadership ?? ''] as number | undefined
  if (interest !== undefined) parts.push(interest)
  const r = rating(a.skills.leadership)
  if (r !== undefined) parts.push(r / 2)
  if (parts.length === 0) return null
  if (a.teamStyle === 'take_charge') parts.push(1)
  return parts.reduce((x, y) => x + y, 0) / parts.length
}

/** Lower-case, accents stripped, punctuation to spaces, single-spaced. */
export function normaliseName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface NameCandidate {
  participantId: string
  firstName: string
  lastName: string
}

export interface TeammateMatch {
  typed: string
  /** The one roster student this name matches; null when none or ambiguous. */
  participantId: string | null
}

/**
 * Matches the names a student typed to the event roster. A full name must
 * match exactly (after normalising); a first name alone counts only when one
 * student on the roster has it. Anything else is left for staff to read.
 */
export function matchTeammates(typed: string[], roster: NameCandidate[], selfId: string): TeammateMatch[] {
  const others = roster.filter((r) => r.participantId !== selfId)
  return typed.map((raw) => {
    const name = normaliseName(raw)
    if (!name) return { typed: raw, participantId: null }
    const full = others.filter((r) => normaliseName(`${r.firstName} ${r.lastName}`) === name)
    if (full.length === 1) return { typed: raw, participantId: full[0].participantId }
    if (full.length > 1) return { typed: raw, participantId: null }
    const first = others.filter((r) => normaliseName(r.firstName) === name)
    if (first.length === 1) return { typed: raw, participantId: first[0].participantId }
    // "Sam J": first name plus a last initial.
    const [f, l] = name.split(' ')
    if (f && l && l.length === 1) {
      const initial = others.filter((r) => normaliseName(r.firstName) === f && normaliseName(r.lastName).startsWith(l))
      if (initial.length === 1) return { typed: raw, participantId: initial[0].participantId }
    }
    return { typed: raw, participantId: null }
  })
}

/** "Lincoln High School" and "lincoln high" are the same school for mixing. */
export function normaliseSchool(s: string | null | undefined): string | null {
  if (!s) return null
  const n = normaliseName(s)
    .replace(/\b(the|school|high|middle|academy|secondary|college|hs|ms)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return n || normaliseName(s) || null
}
