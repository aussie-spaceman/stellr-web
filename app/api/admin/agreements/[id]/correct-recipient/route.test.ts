import { describe, it, expect, vi, beforeEach } from 'vitest'

const { requireEventAccess, correct, logActivity, agreementRow } = vi.hoisted(() => ({
  requireEventAccess: vi.fn(async (_slug?: string): Promise<Record<string, unknown>> => ({ ok: true, isAdmin: false, assignedSlugs: ['colorado'] })),
  correct: vi.fn(async (_db: unknown, _input: unknown): Promise<unknown> => ({ kind: 'not_found' })),
  logActivity: vi.fn(async (_entry: unknown, _db: unknown) => {}),
  agreementRow: { current: { event_slug: 'colorado' } as Record<string, unknown> | null },
}))

vi.mock('@/lib/event-access', () => ({ requireEventAccess }))
vi.mock('@/lib/agreement-correction', () => ({ correctAgreementRecipient: correct }))
vi.mock('@/lib/docusign-recipients', () => ({ syncEnvelopeRecipients: vi.fn(async () => []) }))
vi.mock('@/lib/activity-log', () => ({ actorFromAuth: async () => ({ actorType: 'admin', actorMemberId: 'admin-1' }), logActivity }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: agreementRow.current }) }
      return chain
    },
  }),
}))

const { POST } = await import('./route')

function post(body: unknown, id = 'row-1') {
  return POST(
    new Request(`https://app.stellreducation.org/api/admin/agreements/${id}/correct-recipient`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  )
}

const CORRECTED = {
  kind: 'corrected',
  recipient: { recipientId: '1', roleName: 'Guardian', email: 'new@example.com', status: 'sent' },
  previousEmail: 'old@example.com', participantField: 'emergency_contact_email', participantSkipped: null,
  eventSlug: 'colorado', memberId: 'm-1', participantId: 'p-1', provider: 'docusign', envelopeId: 'env-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  agreementRow.current = { event_slug: 'colorado' }
  requireEventAccess.mockResolvedValue({ ok: true, isAdmin: false, assignedSlugs: ['colorado'] })
})

describe('POST /api/admin/agreements/[id]/correct-recipient', () => {
  it('401s a signed-out caller before looking the agreement up', async () => {
    requireEventAccess.mockResolvedValueOnce({ ok: false, status: 401 })
    agreementRow.current = null
    expect((await post({ recipientId: '1', email: 'new@example.com' }, 'does-not-exist')).status).toBe(401)
    expect(correct).not.toHaveBeenCalled()
  })

  it("403s an event manager on an event that isn't theirs", async () => {
    requireEventAccess.mockResolvedValueOnce({ ok: true, isAdmin: false, assignedSlugs: ['texas'] })
    expect((await post({ recipientId: '1', email: 'new@example.com' })).status).toBe(403)
    expect(correct).not.toHaveBeenCalled()
  })

  it('keeps an agreement with no event to admins', async () => {
    agreementRow.current = { event_slug: null }
    expect((await post({ recipientId: '1', email: 'new@example.com' })).status).toBe(403)
    requireEventAccess.mockResolvedValueOnce({ ok: true, isAdmin: true, assignedSlugs: null })
    correct.mockResolvedValueOnce(CORRECTED)
    expect((await post({ recipientId: '1', email: 'new@example.com' })).status).toBe(200)
  })

  it('corrects, logs the change and reports the participant field', async () => {
    correct.mockResolvedValueOnce(CORRECTED)
    const res = await post({ recipientId: '1', email: 'new@example.com' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, participantField: 'emergency_contact_email' })
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'm-1', action: 'docusign_corrected', metadata: expect.objectContaining({ from: 'old@example.com', to: 'new@example.com' }) }),
      expect.anything(),
    )
  })

  it('answers a refusal with 409 and its message', async () => {
    correct.mockResolvedValueOnce({ kind: 'refused', code: 'RECIPIENT_FINISHED', message: 'Pat has already signed' })
    const res = await post({ recipientId: '1', email: 'new@example.com' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Pat has already signed', code: 'RECIPIENT_FINISHED' })
    expect(logActivity).not.toHaveBeenCalled()
  })

  it('400s a missing field and 404s an unknown agreement', async () => {
    expect((await post({ recipientId: '1' })).status).toBe(400)
    agreementRow.current = null
    expect((await post({ recipientId: '1', email: 'a@example.com' })).status).toBe(404)
  })
})
