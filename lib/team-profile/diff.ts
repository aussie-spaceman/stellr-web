// What changed between two of a student's team profiles, for "how my answers
// changed" on the account page. Pure.

import {
  FOCUS_AREAS,
  LEADERSHIP_INTEREST,
  RATING_LEVELS,
  SKILL_AREAS,
  SOFT_SKILLS,
  TEAM_STYLES,
  labelOf,
  type TeamProfileAnswers,
} from './questions'

export interface AnswerChange {
  label: string
  from: string
  to: string
}

export function diffAnswers(before: TeamProfileAnswers, after: TeamProfileAnswers): AnswerChange[] {
  const out: AnswerChange[] = []
  const push = (label: string, from: string, to: string) => {
    if (from !== to) out.push({ label, from: from || '—', to: to || '—' })
  }
  for (const s of SKILL_AREAS) push(s.label, labelOf(RATING_LEVELS, before.skills[s.key]), labelOf(RATING_LEVELS, after.skills[s.key]))

  const list = (keys: string[]) => keys.map((k) => labelOf(SOFT_SKILLS, k)).sort().join(', ')
  push('Strengths', list(before.strengths), list(after.strengths))
  push('Would like to get better at', list(before.weaknesses), list(after.weaknesses))
  push('Wants to work on', labelOf(FOCUS_AREAS, before.focus), labelOf(FOCUS_AREAS, after.focus))
  push('Helps a team by', labelOf(TEAM_STYLES, before.teamStyle), labelOf(TEAM_STYLES, after.teamStyle))
  push('Leadership role', labelOf(LEADERSHIP_INTEREST, before.leadership), labelOf(LEADERSHIP_INTEREST, after.leadership))
  push(
    'Presenting comfort',
    before.presentingComfort ? `${before.presentingComfort} / 5` : '',
    after.presentingComfort ? `${after.presentingComfort} / 5` : '',
  )
  return out
}
