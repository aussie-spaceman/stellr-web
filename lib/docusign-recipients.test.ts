import { describe, it, expect, vi, beforeEach } from 'vitest'

const { announceBounces, fetchEnvelopeRecipients } = vi.hoisted(() => ({
  announceBounces: vi.fn(async () => 1),
  fetchEnvelopeRecipients: vi.fn(),
}))
// Who is told is lib/esign/bounce-notices.ts (its own tests, incl. DS-5 escaping).
vi.mock('./esign/bounce-notices', () => ({ announceBounces }))
vi.mock('./esign/operations', () => ({ fetchEnvelopeRecipients }))

import { loadRecipientsByEnvelopeRows, syncEnvelopeRecipients } from './docusign-recipients'
import type { EnvelopeRecipient } from './docusign'
import { fakeSupabase } from '@/test/fake-supabase'

const recipient = (over: Partial<EnvelopeRecipient>): EnvelopeRecipient => ({
  recipientId: '1', roleName: 'Guardian', name: 'Pat Rivera', email: 'pat@home.test',
  status: 'autoresponded', routingOrder: 1, deliveredAt: null, signedAt: null, declinedAt: null,
  ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('syncEnvelopeRecipients announces bounces wherever it runs', () => {
  const db = () =>
    fakeSupabase({
      agreements: [{ id: 'env-1', signers_total: 0, signers_completed: 0, updated_at: null }],
      agreement_recipients: [],
    })

  // Before 9 Nov 2026 only the Connect webhook alerted, so a bounce first seen
  // by the reminder cron or the roster refresh was recorded and never told.
  it('announces a DocuSign bounce from any sync (cron, roster refresh, Connect)', async () => {
    const fake = db()
    fetchEnvelopeRecipients.mockResolvedValue([recipient({})])
    await syncEnvelopeRecipients(fake.client, 'env-1', 'ds-env', 'docusign')
    expect(fake.table('agreement_recipients')).toHaveLength(1)
    expect(announceBounces).toHaveBeenCalledWith(fake.client, 'env-1', { kind: 'bounced' })
  })

  it('announces from a Stellr signing sync too', async () => {
    const fake = db()
    fetchEnvelopeRecipients.mockResolvedValue([recipient({})])
    await syncEnvelopeRecipients(fake.client, 'env-1', 'native-env', 'native')
    expect(announceBounces).toHaveBeenCalledWith(fake.client, 'env-1', { kind: 'bounced' })
  })

  it('says nothing when nobody bounced', async () => {
    const fake = db()
    fetchEnvelopeRecipients.mockResolvedValue([recipient({ status: 'sent' })])
    await syncEnvelopeRecipients(fake.client, 'env-1', 'ds-env', 'docusign')
    expect(announceBounces).not.toHaveBeenCalled()
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
