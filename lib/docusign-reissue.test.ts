import { describe, it, expect, vi, beforeEach } from 'vitest'

const { resendEnvelope, voidEnvelope, dispatchAgreement } = vi.hoisted(() => ({
  resendEnvelope: vi.fn(async (_id: string) => 1),
  voidEnvelope: vi.fn(async (_id: string, _reason?: string) => {}),
  dispatchAgreement: vi.fn(async (_db: unknown, _ctx: unknown) => 'issued' as const),
}))

vi.mock('./docusign', async () => ({
  resendEnvelope,
  voidEnvelope,
  classifyAgreement: (role: string | null) => (role === 'participant' ? 'minor' : role ? 'adult' : null),
}))
vi.mock('./docusign-agreements', () => ({ dispatchAgreement }))

const { reissueParticipantAgreement } = await import('./docusign-reissue')

// Minimal supabase stand-in: every chain resolves to the data registered per
// table; updates are recorded.
function fakeDb(state: {
  participant?: Record<string, unknown> | null
  envelope?: Record<string, unknown> | null
  bounced?: { email: string }[]
}) {
  const updates: { table: string; values: Record<string, unknown> }[] = []
  const db = {
    updates,
    from(table: string) {
      const result =
        table === 'participants' ? state.participant ?? null
        : table === 'docusign_envelopes' ? state.envelope ?? null
        : state.bounced ?? []
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order', 'limit']) chain[m] = () => chain
      chain.maybeSingle = async () => ({ data: result, error: null })
      chain.then = (resolve: (v: unknown) => void) => resolve({ data: result, error: null })
      chain.update = (values: Record<string, unknown>) => {
        updates.push({ table, values })
        return { eq: async () => ({ error: null }) }
      }
      return chain
    },
  }
  return db
}

const PARTICIPANT = {
  id: 'p-1', member_id: 'm-1', first_name: 'Lily', last_name: 'N', email: 'lily@example.com',
  date_of_birth: '2012-01-01', event_role: 'participant',
  emergency_contact_email: 'parent@example.com',
  registrations: { event_slug: 'colorado', event_title: 'CO SDC', school_name: null, school_address_state: 'CO' },
}

beforeEach(() => vi.clearAllMocks())

describe('reissueParticipantAgreement', () => {
  it('resends a live envelope without spending quota', async () => {
    const db = fakeDb({ participant: PARTICIPANT, envelope: { id: 'row-1', envelope_id: 'env-1', status: 'sent' } })
    const r = await reissueParticipantAgreement(db as never, 'p-1', { eventSlug: 'colorado' })
    expect(r).toEqual({ kind: 'resent', envelopeRowId: 'row-1', recipients: 1 })
    expect(resendEnvelope).toHaveBeenCalledWith('env-1')
    expect(dispatchAgreement).not.toHaveBeenCalled()
    // Manual resends must never touch the cron's cadence column.
    expect(db.updates[0].values).toHaveProperty('last_manual_resend_at')
    expect(db.updates[0].values).not.toHaveProperty('reminder_sent_at')
  })

  it('asks before issuing a new envelope for a voided one', async () => {
    const db = fakeDb({ participant: PARTICIPANT, envelope: { id: 'row-1', envelope_id: 'env-1', status: 'voided' } })
    const r = await reissueParticipantAgreement(db as never, 'p-1')
    expect(r).toMatchObject({ kind: 'needs_confirm', reason: 'voided' })
    expect(dispatchAgreement).not.toHaveBeenCalled()
  })

  it('issues a new envelope once confirmed', async () => {
    const db = fakeDb({ participant: PARTICIPANT, envelope: null })
    const r = await reissueParticipantAgreement(db as never, 'p-1', { allowNewEnvelope: true })
    expect(r).toEqual({ kind: 'reissued', outcome: 'issued' })
    expect(dispatchAgreement).toHaveBeenCalledWith(db, expect.objectContaining({
      participantId: 'p-1', eventSlug: 'colorado', guardianEmail: 'parent@example.com',
    }))
  })

  it('voids a bounced envelope before re-issuing, only when confirmed', async () => {
    const state = {
      participant: PARTICIPANT,
      envelope: { id: 'row-1', envelope_id: 'env-1', status: 'sent' },
      bounced: [{ email: 'parent@example.com' }],
    }
    expect(await reissueParticipantAgreement(fakeDb(state) as never, 'p-1'))
      .toMatchObject({ kind: 'needs_confirm', reason: 'bounced' })
    expect(resendEnvelope).not.toHaveBeenCalled()
    expect(voidEnvelope).not.toHaveBeenCalled()

    const db = fakeDb(state)
    expect(await reissueParticipantAgreement(db as never, 'p-1', { allowNewEnvelope: true }))
      .toEqual({ kind: 'reissued', outcome: 'issued' })
    expect(voidEnvelope).toHaveBeenCalledWith('env-1', expect.any(String))
    expect(db.updates[0].values).toMatchObject({ status: 'voided' })
  })

  it('does nothing for signed paperwork or another event', async () => {
    const signed = fakeDb({ participant: PARTICIPANT, envelope: { id: 'r', envelope_id: 'e', status: 'completed' } })
    expect(await reissueParticipantAgreement(signed as never, 'p-1')).toMatchObject({ kind: 'nothing_to_do', reason: 'completed' })

    const other = fakeDb({ participant: PARTICIPANT })
    expect(await reissueParticipantAgreement(other as never, 'p-1', { eventSlug: 'texas' })).toEqual({ kind: 'not_found' })
  })
})
