import { describe, expect, it } from 'vitest'
import { EMPTY_ANSWERS, missingAnswers, normaliseAnswers } from './questions'
import { leaderScore, matchTeammates, normaliseSchool, skillVector } from './vectors'
import { diffAnswers } from './diff'

const complete = normaliseAnswers({
  skills: { art: 'beginner', writing: 'advanced', presenting: 'intermediate', science_maths: 'advanced', engineering: 'beginner', leadership: 'advanced' },
  strengths: ['problem_solving', 'curiosity'],
  weaknesses: ['time_management'],
  focus: 'science',
  teamStyle: 'take_charge',
  leadership: 'yes',
  presentingComfort: 4,
  competitions: ['robotics'],
  teammates: ['Sam Lee'],
})

describe('normaliseAnswers', () => {
  it('drops unknown keys and values', () => {
    const a = normaliseAnswers({
      skills: { art: 'expert', writing: 'advanced', hacking: 'advanced' },
      strengths: ['creativity', 'magic', 'creativity'],
      focus: 'wizardry',
      presentingComfort: 9,
      teammates: ['  Ana  ', '', 'Ben', 'Cy'],
    })
    expect(a.skills).toEqual({ writing: 'advanced' })
    expect(a.strengths).toEqual(['creativity'])
    expect(a.focus).toBeNull()
    expect(a.presentingComfort).toBeNull()
    expect(a.teammates).toEqual(['Ana', 'Ben'])
  })

  it('never lets a skill be both a strength and an area to work on', () => {
    const a = normaliseAnswers({ strengths: ['teamwork'], weaknesses: ['teamwork', 'adaptability'] })
    expect(a.weaknesses).toEqual(['adaptability'])
  })

  it('treats "None yet" as exclusive and keeps "Other" text only with Other', () => {
    expect(normaliseAnswers({ competitions: ['robotics', 'none'] }).competitions).toEqual(['none'])
    expect(normaliseAnswers({ competitions: ['robotics'], competitionsOther: 'x' }).competitionsOther).toBe('')
    expect(normaliseAnswers({ competitions: ['other'], competitionsOther: 'Rocketry club' }).competitionsOther).toBe('Rocketry club')
  })

  it('reads garbage as empty', () => {
    expect(normaliseAnswers(null)).toEqual(EMPTY_ANSWERS)
    expect(normaliseAnswers('x')).toEqual(EMPTY_ANSWERS)
  })
})

describe('missingAnswers', () => {
  it('lists required questions until answered', () => {
    expect(missingAnswers(EMPTY_ANSWERS)).toContain('strengths')
    expect(missingAnswers(complete)).toEqual([])
  })
})

describe('vectors', () => {
  it('builds a fixed-length skill vector', () => {
    expect(skillVector(complete)).toHaveLength(skillVector(EMPTY_ANSWERS).length)
    expect(skillVector(complete)).toContain(-1)
  })

  it('scores leadership from interest, rating and style', () => {
    expect(leaderScore(EMPTY_ANSWERS)).toBeNull()
    expect(leaderScore(complete)).toBe(1)
    expect(leaderScore(normaliseAnswers({ leadership: 'no', skills: { leadership: 'beginner' } }))).toBe(0)
  })
})

describe('matchTeammates', () => {
  const roster = [
    { participantId: 'p1', firstName: 'Sam', lastName: 'Lee' },
    { participantId: 'p2', firstName: 'Sam', lastName: 'Jones' },
    { participantId: 'p3', firstName: 'Zoë', lastName: 'Ortiz' },
    { participantId: 'me', firstName: 'Ana', lastName: 'Ruiz' },
  ]

  it('matches full names, unique first names and first-name-plus-initial', () => {
    const m = matchTeammates(['sam lee', 'Zoe', 'Sam J', 'Sam', 'Nobody', 'Ana'], roster, 'me')
    expect(m.map((x) => x.participantId)).toEqual(['p1', 'p3', 'p2', null, null, null])
  })
})

describe('diffAnswers', () => {
  it('lists only what changed', () => {
    const after = normaliseAnswers({ ...complete, skills: { ...complete.skills, writing: 'intermediate' }, strengths: ['problem_solving'] })
    const changes = diffAnswers(complete, after)
    expect(changes.map((c) => c.label)).toEqual(['Writing', 'Strengths'])
    expect(changes[0]).toEqual({ label: 'Writing', from: 'Advanced', to: 'Intermediate' })
    expect(diffAnswers(complete, complete)).toEqual([])
  })
})

describe('normaliseSchool', () => {
  it('treats common suffixes as the same school', () => {
    expect(normaliseSchool('Lincoln High School')).toBe(normaliseSchool('lincoln high'))
    expect(normaliseSchool(null)).toBeNull()
  })
})
