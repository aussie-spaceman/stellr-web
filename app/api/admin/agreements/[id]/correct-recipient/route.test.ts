// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { session, assigned, correct, logActivity, agreementRow, recipients } = vi.hoisted(() => ({
  session: { current: {} as Record<string, unknown> },
  assigned: { current: [] as string[] },
  correct: vi.fn(async (_db: unknown, _input: unknown): Promise<unknown> => ({ kind: 'not_found' })),
  logActivity: vi.fn(async (_entry: unknown, _db: unknown) => {}),
  agreementRow: { current: { event_slug: 'colorado' } as Record<string, unknown> | null },
  recipients: { current: [] as Record<string, unknown>[] },
}))

const eventManager = (slugs: string[]) => {
  session.current = { userId: 'user_em', sessionClaims: { metadata: { role: 'event_manager' } } }
  assigned.current = slugs
}
const admin = () => {
  session.current = { userId: 'user_admin', sessionClaims: { metadata: { role: 'admin' } } }
  assigned.current = []
}

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => session.current }))
vi.mock('@/lib/agreement-correction', () => ({ correctAgreementRecipient: correct }))
vi.mock('@/lib/docusign-recipients', () => ({ syncEnvelopeRecipients: vi.fn(async () => []) }))
vi.mock('@/lib/activity-log', () => ({ actorFromAuth: async () => ({ actorType: 'admin', actorMemberId: 'admin-1' }), logActivity }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const list = () =>
        table === 'event_manager_assignments'
          ? assigned.current.map((event_slug) => ({ clerk_user_id: session.current.userId, event_slug, tenant_id: null }))
          : recipients.current
      const chain = {
        select: () => chain,
        eq: () => chain,
        or: () => chain,
        order: () => chain,
        maybeSingle: async () => ({ data: agreementRow.current }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: list(), error: null }),
      }
      return chain
    },
  }),
}))

const { GET, POST } = await import('./route')

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
  recipients.current = []
  eventManager(['colorado'])
})

describe('POST /api/admin/agreements/[id]/correct-recipient', () => {
  it('401s a signed-out caller before looking the agreement up', async () => {
    session.current = { userId: null, sessionClaims: null }
    agreementRow.current = null
    expect((await post({ recipientId: '1', email: 'new@example.com' }, 'does-not-exist')).status).toBe(401)
    expect(correct).not.toHaveBeenCalled()
  })

  it("refuses an event manager on an event that isn't theirs, as if the agreement were missing", async () => {
    eventManager(['texas'])
    const refused = await post({ recipientId: '1', email: 'new@example.com' })
    expect(refused.status).toBe(404)
    agreementRow.current = null
    expect(await refused.json()).toEqual(await (await post({ recipientId: '1', email: 'new@example.com' })).json())
    expect(correct).not.toHaveBeenCalled()
  })

  it('keeps an agreement with no event to admins', async () => {
    agreementRow.current = { event_slug: null }
    expect((await post({ recipientId: '1', email: 'new@example.com' })).status).toBe(404)
    admin()
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

describe('GET /api/admin/agreements/[id]/correct-recipient', () => {
  it('lists the signers for the event manager of that event', async () => {
    agreementRow.current = { event_slug: 'colorado', envelope_id: 'env-1', provider: 'docusign', status: 'completed' }
    recipients.current = [{ recipient_id: '1', role_name: 'Guardian', name: 'A', email: 'a@example.com', status: 'signed', routing_order: 1 }]
    const res = await GET(new Request('https://app.test/x'), { params: Promise.resolve({ id: 'row-1' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      status: 'completed',
      recipients: [{ recipientId: '1', roleName: 'Guardian', name: 'A', email: 'a@example.com', status: 'signed', routingOrder: 1 }],
    })
  })
})
