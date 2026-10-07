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
