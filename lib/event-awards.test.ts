import { describe, it, expect } from 'vitest'
import {
  ASSIGNED_AWARD_TYPES,
  AWARD_TYPES,
  EVENT_AWARDS,
  INDIVIDUAL_AWARD_TYPES,
  PUBLIC_AWARDS,
  assignmentConflict,
  awardCredentialTitle,
  isAssignedAwardType,
  isAwardType,
  mentorCredentialTitle,
  relabelIssuedAward,
  artworkSupersededFor,
  replacedSpecialist,
  type Assignment,
} from './event-awards'

const a = (awardType: Assignment['awardType'], participantId: string, companyId: string | null = 'co-1'): Assignment => ({
  awardType, participantId, companyId,
})

describe('award catalogue', () => {
  it('has the six certificates with their current labels', () => {
    expect(AWARD_TYPES).toEqual(['participation', 'overall_champion', 'norm_chaffee', 'anita_gale', 'dick_edwards', 'mentor'])
    expect(EVENT_AWARDS.norm_chaffee.label).toBe('Norm Chaffee Award for Engineering Excellence')
    expect(EVENT_AWARDS.norm_chaffee.description).toBe('For excellence at this event.')
    expect(EVENT_AWARDS.mentor.label).toBe('Certificate of Appreciation')
    expect(EVENT_AWARDS.overall_champion.label).toBe('Overall Event Champions')
    expect(EVENT_AWARDS.anita_gale.label).toBe('Anita Gale Award for Creative Vision')
    expect(EVENT_AWARDS.dick_edwards.label).toBe('Dick Edwards Award for Quiet Leadership')
  })

  it('guards types', () => {
    expect(isAwardType('participation')).toBe(true)
    expect(isAwardType('best_hat')).toBe(false)
    expect(isAssignedAwardType('participation')).toBe(false)
    expect(isAssignedAwardType('anita_gale')).toBe(true)
    expect(isAssignedAwardType('norm_chaffee')).toBe(true)
    // The mentor certificate is never judged or assigned per student.
    expect(isAwardType('mentor')).toBe(true)
    expect(isAssignedAwardType('mentor')).toBe(false)
  })

  it('titles mentor credentials with the event then the role', () => {
    expect(mentorCredentialTitle('Colorado Space Design Challenge')).toBe('Colorado Space Design Challenge — Volunteer Mentor')
  })

  it('titles award credentials with the award then the event', () => {
    expect(awardCredentialTitle('anita_gale', 'Colorado Space Design Challenge'))
      .toBe('Anita Gale Award for Creative Vision — Colorado Space Design Challenge')
    expect(awardCredentialTitle('norm_chaffee', 'Colorado Space Design Challenge'))
      .toBe('Norm Chaffee Award for Engineering Excellence — Colorado Space Design Challenge')
  })
})

describe('PUBLIC_AWARDS', () => {
  it('explains the four decided awards, by their short names', () => {
    expect(PUBLIC_AWARDS.map((p) => p.type).sort()).toEqual([...ASSIGNED_AWARD_TYPES].sort())
    expect(PUBLIC_AWARDS.map((p) => p.name)).toEqual([
      'Creative Vision Award', 'Quiet Leadership Award', 'Champions Award', 'Engineering Excellence Award',
    ])
  })

  it('has the judges pick the champions and the mentors pick the rest', () => {
    for (const p of PUBLIC_AWARDS) {
      expect(p.decidedBy).toBe(p.type === 'overall_champion' ? 'judges' : 'mentors')
    }
  })

  it('invites every individual award winner to Summer Camp, but not the champion company as such', () => {
    const invited = PUBLIC_AWARDS.filter((p) => p.summerCamp).map((p) => p.type).sort()
    expect(invited).toEqual([...INDIVIDUAL_AWARD_TYPES].sort())
  })
})

describe('relabelIssuedAward', () => {
  // An issued credential keeps the label text it was issued with; the renamed
  // awards are shown with their current label. Stand-in wording only here.
  const issued = { award_type: 'dick_edwards', award: 'Earlier Wording for Quiet Leadership', title: 'Earlier Wording for Quiet Leadership — Colorado Space Design Challenge' }

  it('shows the current label in the award and in front of the event', () => {
    expect(relabelIssuedAward(issued)).toMatchObject({
      award: 'Dick Edwards Award for Quiet Leadership',
      title: 'Dick Edwards Award for Quiet Leadership — Colorado Space Design Challenge',
    })
  })

  it('does not touch the stored row', () => {
    relabelIssuedAward(issued)
    expect(issued.award).toBe('Earlier Wording for Quiet Leadership')
  })

  it('shows an Overall Champion credential by the full name, Overall Event Champions', () => {
    const champ = { award_type: 'overall_champion', award: 'Overall Champion', title: 'Overall Champion — Nevada' }
    expect(relabelIssuedAward(champ)).toMatchObject({ award: 'Overall Event Champions', title: 'Overall Event Champions — Nevada' })
  })

  it('leaves every other credential exactly as stored', () => {
    const mentor = { award_type: 'mentor', award: 'Certificate of Appreciation', title: 'Nevada — Volunteer Mentor' }
    expect(relabelIssuedAward(mentor)).toBe(mentor)
    const course = { award_type: null, award: null, title: 'STEM Power Skills' }
    expect(relabelIssuedAward(course)).toBe(course)
  })

  it('shows a Norm Chaffee credential issued under its earlier label by its full name', () => {
    const finalist = { award_type: 'norm_chaffee', award: 'Norm Chaffee Finalist', title: 'Norm Chaffee Finalist — Colorado Space Design Challenge' }
    expect(relabelIssuedAward(finalist)).toMatchObject({
      award: 'Norm Chaffee Award for Engineering Excellence',
      title: 'Norm Chaffee Award for Engineering Excellence — Colorado Space Design Challenge',
    })
  })

  it('prints every award on its uploaded artwork again: the full names match it', () => {
    expect(artworkSupersededFor('anita_gale')).toBe(false)
    expect(artworkSupersededFor('dick_edwards')).toBe(false)
    expect(artworkSupersededFor('overall_champion')).toBe(false)
    expect(artworkSupersededFor('norm_chaffee')).toBe(false)
    expect(artworkSupersededFor(null)).toBe(false)
  })
})

describe('assignmentConflict', () => {
  it('allows a champion who also holds a specialist award (three certificates)', () => {
    expect(assignmentConflict([a('anita_gale', 'p1')], a('overall_champion', 'p1'))).toBeNull()
  })

  it('refuses a second specialist award for the same student', () => {
    expect(assignmentConflict([a('anita_gale', 'p1')], a('dick_edwards', 'p1'))).toMatch(/one individual award per event/)
  })

  it('treats re-picking the award already held as a no-op', () => {
    expect(assignmentConflict([a('anita_gale', 'p1')], a('anita_gale', 'p1'))).toBeNull()
  })

  it('lets each company have its own specialist winner', () => {
    expect(assignmentConflict([a('anita_gale', 'p1', 'co-1')], a('anita_gale', 'p2', 'co-2'))).toBeNull()
  })
})

describe('assignmentConflict — Norm Chaffee Award', () => {
  const champs = [a('overall_champion', 'p1'), a('overall_champion', 'p2')]

  it('allows any number of champions as finalists', () => {
    expect(assignmentConflict(champs, a('norm_chaffee', 'p1'))).toBeNull()
    expect(assignmentConflict([...champs, a('norm_chaffee', 'p1')], a('norm_chaffee', 'p2'))).toBeNull()
  })

  it('refuses a student who is not in the winning company', () => {
    expect(assignmentConflict(champs, a('norm_chaffee', 'p3'))).toMatch(/Only members of the winning company \(Overall Event Champions\)/)
    expect(assignmentConflict([a('anita_gale', 'p1')], a('norm_chaffee', 'p1'))).toMatch(/Only members of the winning company \(Overall Event Champions\)/)
  })

  it('refuses a finalist who already holds a specialist award', () => {
    expect(assignmentConflict([...champs, a('dick_edwards', 'p1')], a('norm_chaffee', 'p1')))
      .toMatch(/Already holds the Dick Edwards Award for Quiet Leadership\. A student can win one individual award per event/)
  })

  it('refuses a specialist award for a finalist', () => {
    expect(assignmentConflict([...champs, a('norm_chaffee', 'p1')], a('anita_gale', 'p1')))
      .toMatch(/Already holds the Norm Chaffee Award for Engineering Excellence\. A student can win one individual award per event/)
  })

  it('is not one per company: finalists never replace each other', () => {
    expect(replacedSpecialist([a('norm_chaffee', 'p1')], a('norm_chaffee', 'p2'))).toBeNull()
  })
})

describe('replacedSpecialist', () => {
  it('finds the current winner in the same company', () => {
    const existing = [a('anita_gale', 'p1', 'co-1'), a('anita_gale', 'p3', 'co-2')]
    expect(replacedSpecialist(existing, a('anita_gale', 'p2', 'co-1'))?.participantId).toBe('p1')
  })

  it('ignores other companies and non-specialist awards', () => {
    expect(replacedSpecialist([a('anita_gale', 'p1', 'co-2')], a('anita_gale', 'p2', 'co-1'))).toBeNull()
    expect(replacedSpecialist([a('overall_champion', 'p1')], a('overall_champion', 'p2'))).toBeNull()
  })
})
