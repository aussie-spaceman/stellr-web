import { describe, it, expect } from 'vitest'
import {
  AWARD_TYPES,
  EVENT_AWARDS,
  assignmentConflict,
  awardCredentialTitle,
  isAssignedAwardType,
  isAwardType,
  replacedSpecialist,
  type Assignment,
} from './event-awards'

const a = (awardType: Assignment['awardType'], participantId: string, companyId: string | null = 'co-1'): Assignment => ({
  awardType, participantId, companyId,
})

describe('award catalogue', () => {
  it('has the four certificates, labelled as on the artwork', () => {
    expect(AWARD_TYPES).toEqual(['participation', 'overall_champion', 'anita_gale', 'dick_edwards'])
    expect(EVENT_AWARDS.overall_champion.label).toBe('Overall Champion')
    expect(EVENT_AWARDS.anita_gale.label).toBe('Anita Gale Award for Creative Vision')
    expect(EVENT_AWARDS.dick_edwards.label).toBe('Dick Edwards Award for Quiet Leadership')
  })

  it('guards types', () => {
    expect(isAwardType('participation')).toBe(true)
    expect(isAwardType('best_hat')).toBe(false)
    expect(isAssignedAwardType('participation')).toBe(false)
    expect(isAssignedAwardType('anita_gale')).toBe(true)
  })

  it('titles award credentials with the award then the event', () => {
    expect(awardCredentialTitle('anita_gale', 'Colorado Space Design Challenge'))
      .toBe('Anita Gale Award for Creative Vision — Colorado Space Design Challenge')
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
