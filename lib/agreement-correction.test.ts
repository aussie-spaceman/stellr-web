import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CorrectionRefusedError } from './esign/types'

const { correctRecipientRow, fetchEnvelopeRecipients, syncEnvelopeRecipients } = vi.hoisted(() => ({
  correctRecipientRow: vi.fn(),
  fetchEnvelopeRecipients: vi.fn(async () => [] as unknown[]),
  syncEnvelopeRecipients: vi.fn(async () => []),
}))
vi.mock('./esign/operations', () => ({ correctRecipientRow, fetchEnvelopeRecipients }))
vi.mock('./docusign-recipients', () => ({ syncEnvelopeRecipients }))

const { correctAgreementRecipient } = await import('./agreement-correction')

// Supabase stand-in: reads resolve to the data registered per table, updates
// are recorded with the table they hit.
function fakeDb(state: {
  agreement?: Record<string, unknown> | null
  recipient?: Record<string, unknown> | null
  participant?: Record<string, unknown> | null
}) {
  const updates: { table: string; values: Record<string, unknown> }[] = []
  const db = {
    updates,
    from(table: string) {
      const result =
        table === 'agreements' ? state.agreement ?? null
        : table === 'agreement_recipients' ? state.recipient ?? null
        : table === 'participants' ? state.participant ?? null
        : null
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order', 'limit']) chain[m] = () => chain
      chain.maybeSingle = async () => ({ data: result, error: null })
      chain.update = (values: Record<string, unknown>) => {
        updates.push({ table, values })
        return { eq: async () => ({ error: null }) }
      }
      return chain
    },
  }
  return db
}

const AGREEMENT = {
  id: 'row-1', envelope_id: 'env-1', provider: 'docusign', status: 'sent', event_slug: 'colorado',
  participant_id: 'p-1', member_id: 'm-1', signer_email: 'chasintgeharvest@gmail.com',
}

beforeEach(() => {
  vi.clearAllMocks()
  correctRecipientRow.mockImplementation(async (_db: unknown, _row: unknown, c: { recipientId: string; email: string }) => ({
    recipientId: c.recipientId, roleName: 'Guardian', name: 'Pat', email: c.email, status: 'sent',
    routingOrder: 1, deliveredAt: null, signedAt: null, declinedAt: null,
  }))
})

describe('correctAgreementRecipient', () => {
  it('corrects a guardian and fixes the guardian email on the participant and the agreement', async () => {
    const db = fakeDb({
      agreement: AGREEMENT,
      recipient: { role_name: 'Guardian', email: 'chasintgeharvest@gmail.com' },
      participant: { emergency_contact_email: 'Chasintgeharvest@gmail.com' },
    })
    const r = await correctAgreementRecipient(db as never, {
      agreementId: 'row-1', recipientId: '1', email: '  ChasingTheHarvest@gmail.com ',
    })
    expect(r).toMatchObject({ kind: 'corrected', participantField: 'emergency_contact_email', participantSkipped: null })
    expect(correctRecipientRow).toHaveBeenCalledWith(db, AGREEMENT, { recipientId: '1', email: 'chasingtheharvest@gmail.com' })
    expect(syncEnvelopeRecipients).toHaveBeenCalledWith(db, 'row-1', 'env-1', 'docusign')
    expect(db.updates).toContainEqual({ table: 'participants', values: { emergency_contact_email: 'chasingtheharvest@gmail.com' } })
    expect(db.updates.find((u) => u.table === 'agreements')?.values.signer_email).toBe('chasingtheharvest@gmail.com')
  })

  it("corrects a student's own address in participants.email and never touches members", async () => {
    const db = fakeDb({
      agreement: AGREEMENT,
      recipient: { role_name: 'Minor', email: 'kid@exmaple.com' },
      participant: { email: 'kid@exmaple.com' },
    })
    const r = await correctAgreementRecipient(db as never, { agreementId: 'row-1', recipientId: '2', email: 'kid@example.com' })
    expect(r).toMatchObject({ kind: 'corrected', participantField: 'email' })
    expect(db.updates.map((u) => u.table)).not.toContain('members')
    // The agreement's signer_email is the guardian's: unchanged by a student correction.
    expect(db.updates.find((u) => u.table === 'agreements')).toBeUndefined()
  })

  it('leaves the participant record alone when it already holds a different address', async () => {
    const db = fakeDb({
      agreement: AGREEMENT,
      recipient: { role_name: 'Guardian', email: 'old@example.com' },
      participant: { emergency_contact_email: 'someone-else@example.com' },
    })
    const r = await correctAgreementRecipient(db as never, { agreementId: 'row-1', recipientId: '1', email: 'new@example.com' })
    expect(r).toMatchObject({ kind: 'corrected', participantField: null })
    expect(r.kind === 'corrected' && r.participantSkipped).toMatch(/different address/)
    expect(db.updates.some((u) => u.table === 'participants')).toBe(false)
  })

  it('refuses the Stellr counter-signer without calling the engine', async () => {
    const db = fakeDb({ agreement: AGREEMENT, recipient: { role_name: 'StellrRepresentative', email: 'ops@stellr.org' } })
    const r = await correctAgreementRecipient(db as never, { agreementId: 'row-1', recipientId: '3', email: 'x@example.com' })
    expect(r).toMatchObject({ kind: 'refused', code: 'STELLR_SIGNER' })
    expect(correctRecipientRow).not.toHaveBeenCalled()
  })

  it('refuses an invalid address and a no-op change', async () => {
    const db = fakeDb({ agreement: AGREEMENT, recipient: { role_name: 'Guardian', email: 'same@example.com' } })
    expect(await correctAgreementRecipient(db as never, { agreementId: 'row-1', recipientId: '1', email: 'not an email' }))
      .toMatchObject({ kind: 'refused', code: 'INVALID_EMAIL' })
    expect(await correctAgreementRecipient(db as never, { agreementId: 'row-1', recipientId: '1', email: 'SAME@example.com' }))
      .toMatchObject({ kind: 'refused', code: 'UNCHANGED' })
    expect(correctRecipientRow).not.toHaveBeenCalled()
  })

  it("passes the engine's refusal back as a result, and changes nothing", async () => {
    correctRecipientRow.mockRejectedValueOnce(new CorrectionRefusedError('docusign', 'Already signed', 'RECIPIENT_FINISHED'))
    const db = fakeDb({ agreement: AGREEMENT, recipient: { role_name: 'Guardian', email: 'a@example.com' } })
    const r = await correctAgreementRecipient(db as never, { agreementId: 'row-1', recipientId: '1', email: 'b@example.com' })
    expect(r).toEqual({ kind: 'refused', code: 'RECIPIENT_FINISHED', message: 'Already signed' })
    expect(db.updates).toEqual([])
  })

  it('looks the signer up from the engine when the envelope was never mirrored', async () => {
    fetchEnvelopeRecipients.mockResolvedValueOnce([{ recipientId: '1', roleName: 'Guardian', email: 'old@example.com' }])
    const db = fakeDb({ agreement: AGREEMENT, recipient: null, participant: { emergency_contact_email: 'old@example.com' } })
    const r = await correctAgreementRecipient(db as never, { agreementId: 'row-1', recipientId: '1', email: 'new@example.com' })
    expect(r).toMatchObject({ kind: 'corrected', previousEmail: 'old@example.com', participantField: 'emergency_contact_email' })
  })

  it('returns not_found for an unknown agreement', async () => {
    const db = fakeDb({ agreement: null })
    expect(await correctAgreementRecipient(db as never, { agreementId: 'nope', recipientId: '1', email: 'a@example.com' }))
      .toEqual({ kind: 'not_found' })
  })
})
