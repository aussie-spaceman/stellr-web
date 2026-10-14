import { describe, it, expect } from 'vitest'
import {
  AWARD_TYPES,
  EVENT_AWARDS,
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
  it('has the five certificates with their current labels', () => {
    expect(AWARD_TYPES).toEqual(['participation', 'overall_champion', 'anita_gale', 'dick_edwards', 'mentor'])
    expect(EVENT_AWARDS.mentor.label).toBe('Certificate of Appreciation')
    expect(EVENT_AWARDS.overall_champion.label).toBe('Overall Champion')
    expect(EVENT_AWARDS.anita_gale.label).toBe('Award for Creative Vision')
    expect(EVENT_AWARDS.dick_edwards.label).toBe('Award for Quiet Leadership')
  })

  it('guards types', () => {
    expect(isAwardType('participation')).toBe(true)
    expect(isAwardType('best_hat')).toBe(false)
    expect(isAssignedAwardType('participation')).toBe(false)
    expect(isAssignedAwardType('anita_gale')).toBe(true)
    // The mentor certificate is never judged or assigned per student.
    expect(isAwardType('mentor')).toBe(true)
    expect(isAssignedAwardType('mentor')).toBe(false)
  })

  it('titles mentor credentials with the event then the role', () => {
    expect(mentorCredentialTitle('Colorado Space Design Challenge')).toBe('Colorado Space Design Challenge — Volunteer Mentor')
  })

  it('titles award credentials with the award then the event', () => {
    expect(awardCredentialTitle('anita_gale', 'Colorado Space Design Challenge'))
      .toBe('Award for Creative Vision — Colorado Space Design Challenge')
  })
})

describe('relabelIssuedAward', () => {
  // An issued credential keeps the label text it was issued with; the renamed
  // awards are shown with their current label. Stand-in wording only here.
  const issued = { award_type: 'dick_edwards', award: 'Earlier Wording for Quiet Leadership', title: 'Earlier Wording for Quiet Leadership — Colorado Space Design Challenge' }

  it('shows the current label in the award and in front of the event', () => {
    expect(relabelIssuedAward(issued)).toMatchObject({
      award: 'Award for Quiet Leadership',
      title: 'Award for Quiet Leadership — Colorado Space Design Challenge',
    })
  })

  it('does not touch the stored row', () => {
    relabelIssuedAward(issued)
    expect(issued.award).toBe('Earlier Wording for Quiet Leadership')
  })

  it('leaves every other credential exactly as stored', () => {
    const champ = { award_type: 'overall_champion', award: 'Overall Champion', title: 'Overall Champion — Nevada' }
    expect(relabelIssuedAward(champ)).toBe(champ)
    const course = { award_type: null, award: null, title: 'STEM Power Skills' }
    expect(relabelIssuedAward(course)).toBe(course)
  })

  it('uses the default certificate design for the renamed awards only', () => {
    expect(artworkSupersededFor('anita_gale')).toBe(true)
    expect(artworkSupersededFor('dick_edwards')).toBe(true)
    expect(artworkSupersededFor('overall_champion')).toBe(false)
    expect(artworkSupersededFor(null)).toBe(false)
  })
})

describe('assignmentConflict', () => {
  it('allows a champion who also holds a specialist award (three certificates)', () => {
    expect(assignmentConflict([a('anita_gale', 'p1')], a('overall_champion', 'p1'))).toBeNull()
  })

  it('refuses a second specialist award for the same student', () => {
    expect(assignmentConflict([a('anita_gale', 'p1')], a('dick_edwards', 'p1'))).toMatch(/one specialist award per event/)
  })

  it('treats re-picking the award already held as a no-op', () => {
    expect(assignmentConflict([a('anita_gale', 'p1')], a('anita_gale', 'p1'))).toBeNull()
  })

  it('lets each company have its own specialist winner', () => {
    expect(assignmentConflict([a('anita_gale', 'p1', 'co-1')], a('anita_gale', 'p2', 'co-2'))).toBeNull()
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
