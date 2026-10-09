import { describe, it, expect } from 'vitest'
import {
  individualConfirmationEmail,
  groupMemberJoinedEmail,
  studentLeftTeamEmail,
  docusignSentToMinorEmail,
  docusignReminderToMinorEmail,
  outstandingItemsReminderEmail,
  communityReplyEmail,
  campaignProposalReceivedEmail,
  credentialRevokedEmail,
} from '@/lib/email'

// deep review PUB-2 / HTML-injection cluster: every user-supplied value that is
// interpolated into an HTML email body must be escaped. These templates used to
// interpolate names, titles and free text raw. The payload below carries a bare
// anchor and a hidden div (the finding's phishing-overlay shape); after the fix
// neither renders as live markup.
const XSS = '<a/href=https://evil.example>Confirm</a><div/style=display:none>'
const unescaped = (html: string) => html.includes('<a/href') || html.includes('<div/style=display:none>')

describe('HTML email templates escape user-supplied values (PUB-2)', () => {
  it('individualConfirmationEmail escapes the name and event title', () => {
    const { html } = individualConfirmationEmail({
      firstName: XSS, lastName: XSS, membershipId: 'M1', eventTitle: XSS, registrationId: 'r1',
    })
    expect(unescaped(html)).toBe(false)
    expect(html).toContain('&lt;a/href')
  })

  it('groupMemberJoinedEmail escapes member name, email and event title', () => {
    const { html } = groupMemberJoinedEmail({
      registrantFirstName: XSS, memberFirstName: XSS, memberLastName: 'x', memberEmail: XSS,
      eventTitle: XSS, memberCount: 1, totalExpected: 2,
    })
    expect(unescaped(html)).toBe(false)
  })

  it('studentLeftTeamEmail escapes the student name and email', () => {
    const { html } = studentLeftTeamEmail({
      teacherFirstName: XSS, studentFirstName: XSS, studentLastName: 'x', studentEmail: XSS, eventTitle: XSS,
    })
    expect(unescaped(html)).toBe(false)
  })

  it('docusignSentToMinorEmail escapes the guardian name and email', () => {
    const { html } = docusignSentToMinorEmail({
      firstName: XSS, guardianName: XSS, guardianEmail: XSS, eventTitle: XSS,
    })
    expect(unescaped(html)).toBe(false)
  })

  it('docusignReminderToMinorEmail escapes outstanding signer names', () => {
    const { html } = docusignReminderToMinorEmail({
      firstName: XSS, eventTitle: XSS,
      waitingOn: [{ name: XSS, role: 'parent/guardian' }],
    })
    expect(unescaped(html)).toBe(false)
  })

  it('outstandingItemsReminderEmail escapes the guardian name but leaves the text copy clean', () => {
    const { html, text } = outstandingItemsReminderEmail({
      firstName: XSS, eventTitle: XSS, docusign: { minor: true, guardianName: XSS },
    })
    expect(unescaped(html)).toBe(false)
    // The plain-text part keeps the raw name — its meaning must not change.
    expect(text).toContain(XSS)
  })

  it('communityReplyEmail escapes the actor name and post title', () => {
    const { html } = communityReplyEmail({
      recipientFirstName: XSS, actorName: XSS, postTitle: XSS, postUrl: 'https://app.example/x',
    })
    expect(unescaped(html)).toBe(false)
  })

  it('campaignProposalReceivedEmail escapes the file name', () => {
    const { html } = campaignProposalReceivedEmail({
      contactFirstName: XSS, campaignTitle: XSS, fileName: XSS, deadlineLabel: XSS,
    })
    expect(unescaped(html)).toBe(false)
  })

  it('credentialRevokedEmail escapes the quoted reason', () => {
    const { html } = credentialRevokedEmail({
      recipientFirstName: 'Sam', title: 'Award', number: 'STL-1', reason: XSS,
    })
    expect(unescaped(html)).toBe(false)
  })
})
