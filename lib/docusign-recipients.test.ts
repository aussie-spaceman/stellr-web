import { describe, it, expect, vi, beforeEach } from 'vitest'

const { notifyCommunityAdmins } = vi.hoisted(() => ({
  notifyCommunityAdmins: vi.fn(async (_input: unknown) => {}),
}))
vi.mock('./notify', () => ({ notifyCommunityAdmins }))

import { alertOnNewBounces, loadRecipientsByEnvelopeRows } from './docusign-recipients'
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

describe('loadRecipientsByEnvelopeRows', () => {
  it('chunks the envelope-id .in() at 200 and merges every chunk (DS-9)', async () => {
    // deep review DS-9: the admin consent-forms page passes every envelope id at
    // once. An unchunked .in() silently truncated at PostgREST's 1000-row cap and
    // could build an overlong URL. Chunk at 200 and merge, so every id is loaded.
    const inSizes: number[] = []
    let current: string[] = []
    const db = {
      from: () => {
        const chain: Record<string, unknown> = {}
        chain.select = () => chain
        chain.in = (_col: string, ids: string[]) => { inSizes.push(ids.length); current = ids; return chain }
        chain.order = async () => ({
          data: current.map((id) => ({
            envelope_row: id, name: 'P', email: 'p@x', role_name: 'Guardian',
            status: 'sent', delivered_at: null, routing_order: 1, invite_sent_at: null,
            envelope: { provider: 'docusign' },
          })),
          error: null,
        })
        return chain
      },
    } as never

    const ids = Array.from({ length: 450 }, (_, i) => `env-${i}`)
    const map = await loadRecipientsByEnvelopeRows(db, ids)
    expect(inSizes).toEqual([200, 200, 50])
    expect(map.size).toBe(450)
  })
})
