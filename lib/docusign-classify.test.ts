import { describe, it, expect } from 'vitest'
import { classifyAgreement } from '@/lib/docusign'

// Deep review REG-6: a KNOWN minor must always be routed to the guardian-consent
// (minor) agreement, whatever role was selected. A student who picks "College"
// on the individual form is assigned a Mentor role; without the DOB-first check
// they would be sent the adult Mentor agreement and self-sign it with no
// guardian consent.

const MINOR_DOB = '2012-05-01' // 14 as of the 2026 reviews
const ADULT_DOB = '1990-01-01'

describe('classifyAgreement — a minor always gets the minor agreement', () => {
  it('minor DOB + Mentor role → minor (not mentor)', () => {
    expect(classifyAgreement('Mentor', MINOR_DOB)).toBe('minor')
  })
  it('minor DOB + Volunteer role → minor', () => {
    expect(classifyAgreement('Volunteer', MINOR_DOB)).toBe('minor')
  })
  it('adult DOB + Mentor role → mentor (unchanged)', () => {
    expect(classifyAgreement('Mentor', ADULT_DOB)).toBe('mentor')
  })
  it('adult DOB + participant role → minor (student at an adult age still signs the participant/minor doc path by role)', () => {
    // Role-driven: 'participant' maps to the minor/participant document.
    expect(classifyAgreement('participant', ADULT_DOB)).toBe('minor')
  })
  it('adult DOB + adult role → adult', () => {
    expect(classifyAgreement('adult', ADULT_DOB)).toBe('adult')
  })
})
