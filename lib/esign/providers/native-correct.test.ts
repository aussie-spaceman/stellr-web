import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stellr signing's correction: the old emailed link must die (token_version),
// the new address gets an invite only when it is that signer's turn, and the
// document's printed email changes only while nobody has signed.

const { loadEnvelopeByExternalId, loadRecipients, sendInvites, appendAudit } = vi.hoisted(() => ({
  loadEnvelopeByExternalId: vi.fn(),
  loadRecipients: vi.fn(),
  sendInvites: vi.fn(async () => ({ sent: 1, deferred: 0, failed: 0 })),
  appendAudit: vi.fn(async () => ({})),
}))
vi.mock('@/lib/esign/native/flow', async (orig) => ({
  ...(await orig<typeof import('@/lib/esign/native/flow')>()),
  loadEnvelopeByExternalId,
  loadRecipients,
}))
vi.mock('@/lib/esign/outbox', () => ({ sendInvites, signNowUrlFor: () => '' }))
vi.mock('@/lib/esign/native/audit', () => ({ appendAudit }))

const { nativeProvider } = await import('./native')

function fakeDb() {
  const updates: { table: string; values: Record<string, unknown> }[] = []
  return {
    updates,
    from(table: string) {
      return {
        update(values: Record<string, unknown>) {
          updates.push({ table, values })
          return { eq: async () => ({ error: null }) }
        },
      }
    },
  }
}

const ENV = {
  id: 'row-1', envelope_id: 'native-1', provider: 'native', status: 'sent',
  prefill: { GuardianEmail: 'typo@exmaple.com', MinorEmail: 'kid@example.com', GuardianName: 'Pat' },
}
const recipient = (over: Record<string, unknown>) => ({
  id: 'r-1', envelope_row: 'row-1', recipient_id: '1', role_name: 'Guardian', name: 'Pat',
  email: 'typo@exmaple.com', status: 'autoresponded', routing_order: 1, token_version: 3,
  token_expires_at: null, signed_at: null, delivered_at: null, declined_at: null, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  loadEnvelopeByExternalId.mockResolvedValue(ENV)
})

describe('nativeProvider.correctRecipient', () => {
  it('kills the old link, re-invites a bounced signer and rewrites the printed email', async () => {
    loadRecipients.mockResolvedValue([recipient({}), recipient({ id: 'r-2', recipient_id: '2', role_name: 'Minor', email: 'kid@example.com', status: 'created', routing_order: 2 })])
    const db = fakeDb()
    const r = await nativeProvider.correctRecipient({ db: db as never }, 'native-1', { recipientId: '1', email: 'Pat@Example.com' })

    expect(r).toMatchObject({ recipientId: '1', email: 'pat@example.com', status: 'sent' })
    const signerUpdate = db.updates.find((u) => u.table === 'agreement_recipients')!.values
    expect(signerUpdate).toMatchObject({ email: 'pat@example.com', status: 'sent', token_version: 4, invite_sent_at: null })
    expect(db.updates.find((u) => u.table === 'agreements')!.values.prefill).toMatchObject({
      GuardianEmail: 'pat@example.com', MinorEmail: 'kid@example.com',
    })
    expect(sendInvites).toHaveBeenCalledTimes(1)
    expect(appendAudit).toHaveBeenCalledWith(db, expect.objectContaining({
      event: 'corrected', recipientRow: 'r-1',
      detail: expect.objectContaining({ from: 'typo@exmaple.com', to: 'pat@example.com', prefillUpdated: true }),
    }))
  })

  it('updates a queued signer without emailing them early', async () => {
    loadRecipients.mockResolvedValue([recipient({ status: 'sent' }), recipient({ id: 'r-2', recipient_id: '2', role_name: 'Minor', email: 'kid@exmaple.com', status: 'created', routing_order: 2 })])
    const db = fakeDb()
    const r = await nativeProvider.correctRecipient({ db: db as never }, 'native-1', { recipientId: '2', email: 'kid@example.com' })
    expect(r.status).toBe('created')
    expect(sendInvites).not.toHaveBeenCalled()
  })

  it('keeps the signed document text once someone has signed', async () => {
    loadRecipients.mockResolvedValue([
      recipient({ status: 'completed', signed_at: '2026-10-01T00:00:00Z', email: 'parent@example.com' }),
      recipient({ id: 'r-2', recipient_id: '2', role_name: 'Minor', email: 'kid@exmaple.com', status: 'autoresponded', routing_order: 2 }),
    ])
    const db = fakeDb()
    await nativeProvider.correctRecipient({ db: db as never }, 'native-1', { recipientId: '2', email: 'kid@example.com' })
    expect(db.updates.some((u) => u.table === 'agreements')).toBe(false)
    expect(appendAudit).toHaveBeenCalledWith(db, expect.objectContaining({ detail: expect.objectContaining({ prefillUpdated: false }) }))
  })

  it('refuses a signer who has signed, and a finished agreement', async () => {
    loadRecipients.mockResolvedValue([recipient({ status: 'completed' })])
    await expect(nativeProvider.correctRecipient({ db: fakeDb() as never }, 'native-1', { recipientId: '1', email: 'a@example.com' }))
      .rejects.toMatchObject({ name: 'CorrectionRefusedError', code: 'RECIPIENT_FINISHED' })

    loadEnvelopeByExternalId.mockResolvedValueOnce({ ...ENV, status: 'completed' })
    await expect(nativeProvider.correctRecipient({ db: fakeDb() as never }, 'native-1', { recipientId: '1', email: 'a@example.com' }))
      .rejects.toMatchObject({ code: 'ENVELOPE_NOT_CORRECTABLE' })
    expect(sendInvites).not.toHaveBeenCalled()
  })
})
