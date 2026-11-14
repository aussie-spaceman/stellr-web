import { describe, it, expect, vi } from 'vitest'

vi.mock('./notify', () => ({ notifyCommunityAdmins: vi.fn() }))
vi.mock('./email', () => ({ sendEmail: vi.fn() }))

const { issueFailureAlert } = await import('./docusign-agreements')

// TRACKER 22.6: the admin alert for an agreement that could not be issued says
// what is known, which kind of agreement and that none is signed or out yet, and
// nothing about the caller: on the admin Issue and event-assignment paths there
// was no registration, so "Registration succeeded" was wrong there.
describe('issueFailureAlert wording', () => {
  const input = {
    label: 'Mentor and Volunteer Agreement',
    who: 'Sam Rivera',
    email: 'sam@example.org',
    eventTitle: 'Launch Day',
    reason: 'the signing service refused the request: ENVELOPE_LIMIT_EXCEEDED',
    fix: 'Check the signing engine card under Admin → Consent forms, then re-issue. It is retried automatically each day.',
    participantId: 'p-1',
  }

  it('states which agreement, for whom, why, and what is known', () => {
    const alert = issueFailureAlert(input)
    expect(alert.body).toBe(
      'No Mentor and Volunteer Agreement could be issued for Sam Rivera (Launch Day): the signing service refused the request: ENVELOPE_LIMIT_EXCEEDED. ' +
      'No signed Mentor and Volunteer Agreement has been found for them yet, and none is out for signature. ' +
      'Check the signing engine card under Admin → Consent forms, then re-issue. It is retried automatically each day.',
    )
    expect(alert.email.subject).toBe('Action needed: no Mentor and Volunteer Agreement issued for Sam Rivera')
    expect(alert.email.text).toContain('No signed Mentor and Volunteer Agreement has been found for them yet, and none is out for signature.')
    expect(alert).toMatchObject({ type: 'action', referenceType: 'participant', referenceId: 'p-1' })
  })

  it('never claims more than is known', () => {
    const alert = issueFailureAlert(input)
    for (const copy of [alert.body, alert.email.html, alert.email.text]) {
      expect(copy).not.toMatch(/NO paperwork/)
      expect(copy).not.toMatch(/paperwork on file/i)
      expect(copy).not.toMatch(/registration (succeeded|went through)/i)
    }
  })

  it('escapes every value in the HTML', () => {
    const alert = issueFailureAlert({ ...input, who: '<b>Sam</b>', eventTitle: 'A & B' })
    expect(alert.email.html).toContain('&lt;b&gt;Sam&lt;/b&gt;')
    expect(alert.email.html).toContain('A &amp; B')
    expect(alert.email.html).not.toContain('<b>Sam</b>')
  })
})
