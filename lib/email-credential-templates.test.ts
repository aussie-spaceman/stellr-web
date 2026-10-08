import { describe, it, expect } from 'vitest'
import { credentialIssuedEmail } from '@/lib/email'

const URL = 'https://www.stellreducation.org/credentials/STL-2026-XZ9S3EXR'
const VIEW = `${URL}?k=${'A'.repeat(43)}`

// 6 Oct 2026: the button linked to the plain page, which shows a private
// credential only to its holder signed in, so every guardian saw "This
// credential is private". The button now carries the family link.
describe('credentialIssuedEmail', () => {
  const guardian = credentialIssuedEmail({
    recipientFirstName: 'Lily', guardianFirstName: 'Jess', title: 'Anita Gale Award', issuer: 'Stellr Education',
    url: URL, viewUrl: VIEW, isMinor: true, canShare: true,
  })

  it('points the button and the text link at the family link', () => {
    expect(guardian.html).toContain(`href="${VIEW}"`)
    expect(guardian.text).toContain(`View it: ${VIEW}`)
  })

  it('no longer claims anyone with the link can check a private credential', () => {
    expect(guardian.html).not.toContain('Anyone with the link')
    expect(guardian.html).toContain('Once it is public, anyone can check it is genuine')
    expect(guardian.html).toContain('Lily can also see it by signing in to Stellr')
    // The verifier address is the plain one: the token is for the family only.
    expect(guardian.html).toContain(`<a href="${URL}">${URL}</a>`)
    expect(guardian.text).toContain('The link above opens the credential')
  })

  it('falls back to the plain page when no family link is given', () => {
    const e = credentialIssuedEmail({
      recipientFirstName: 'Grace', title: 'Running a Space Design Competition', issuer: 'Stellr Education',
      url: URL, isMinor: false, canShare: true,
    })
    expect(e.html).toContain(`margin:24px 0"><a href="${URL}"`)
    expect(e.html).not.toContain('signing in to Stellr')
  })
})

// Educator PD (7 Oct 2026): the hours and what they are for are said once, and
// a teacher added by an admin (no DOB yet) is told to finish their account —
// not that "paperwork" is missing.
describe('credentialIssuedEmail — educator PD', () => {
  const pd = credentialIssuedEmail({
    recipientFirstName: 'Maria', title: 'Professional Development — Sample Event (8 hours)', issuer: 'Stellr Education',
    url: URL, viewUrl: VIEW, isMinor: false, canShare: false, pdHours: 8,
  })

  it('states the hours and the licence-renewal use', () => {
    expect(pd.html).toContain('<strong>8 hours</strong> of professional development')
    expect(pd.html).toContain('teaching license renewal')
    expect(pd.text).toContain('8 hours of professional development')
  })

  it('points an unfinished account at finishing it', () => {
    expect(pd.html).toContain('Once you have finished setting up your Stellr account')
    expect(pd.html).not.toContain('paperwork on file')
  })

  it('leaves other credentials unchanged', () => {
    const other = credentialIssuedEmail({
      recipientFirstName: 'Grace', title: 'Orbital Mechanics 101', issuer: 'Stellr Education',
      url: URL, isMinor: false, canShare: false,
    })
    expect(other.html).not.toContain('professional development')
    expect(other.html).toContain('paperwork on file')
  })
})
