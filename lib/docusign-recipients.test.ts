import { describe, it, expect, vi, beforeEach } from 'vitest'

const { notifyCommunityAdmins } = vi.hoisted(() => ({
  notifyCommunityAdmins: vi.fn(async (_input: unknown) => {}),
}))
vi.mock('./notify', () => ({ notifyCommunityAdmins }))

import { alertOnNewBounces } from './docusign-recipients'
import type { EnvelopeRecipient } from './docusign'

const recipient = (over: Partial<EnvelopeRecipient>): EnvelopeRecipient => ({
  recipientId: '1', roleName: 'Guardian', name: 'Pat Rivera', email: 'pat@home.test',
  status: 'autoresponded', routingOrder: 1, deliveredAt: null, signedAt: null, declinedAt: null,
  ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('alertOnNewBounces', () => {
  it('escapes registrant-controlled name/email/role in the admin HTML alert (DS-5)', async () => {
    // deep review DS-5: a bounced "signer" whose name/email/role is attacker
    // chosen (public registration feeds these) must not be able to inject markup
    // into the admin HTML email. notify.ts trusts the caller's email.html, so
    // the escaping has to happen here.
    await alertOnNewBounces(
      [],
      [recipient({
        name: '<b>x</b>',
        email: 'a@b.c"><script>alert(1)</script>',
        roleName: '<i>role</i>',
      })],
      { minorName: '<img src=x onerror=alert(1)>', eventTitle: '<u>Event</u>', participantId: 'p-1' },
    )

    expect(notifyCommunityAdmins).toHaveBeenCalledTimes(1)
    const html = (notifyCommunityAdmins.mock.calls[0][0] as { email: { html: string } }).email.html
    // The attacker markup is escaped, never emitted as live tags.
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<b>x</b>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
  })

  it('does nothing when no address newly bounced', async () => {
    await alertOnNewBounces([], [recipient({ status: 'sent' })], { minorName: 'A', eventTitle: 'E', participantId: null })
    expect(notifyCommunityAdmins).not.toHaveBeenCalled()
  })

  it('does not re-alert an address already bounced', async () => {
    const already = [{ email: 'pat@home.test', status: 'autoresponded' } as never]
    await alertOnNewBounces(already, [recipient({})], { minorName: 'A', eventTitle: 'E', participantId: null })
    expect(notifyCommunityAdmins).not.toHaveBeenCalled()
  })
})
