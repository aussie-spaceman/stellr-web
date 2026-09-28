import { describe, it, expect, vi, beforeEach } from 'vitest'

const { requireEventAccess, reissue, logActivity } = vi.hoisted(() => ({
  requireEventAccess: vi.fn(async (_slug: string): Promise<{ ok: boolean; status: number }> => ({ ok: true, status: 200 })),
  reissue: vi.fn(async (_db: unknown, _id: string, _opts: unknown): Promise<unknown> => ({ kind: 'resent', envelopeRowId: 'r', recipients: 1 })),
  logActivity: vi.fn(async (_entry: unknown, _db: unknown) => {}),
}))

vi.mock('@/lib/event-access', () => ({ requireEventAccess }))
vi.mock('@/lib/docusign-reissue', () => ({ reissueParticipantAgreement: reissue }))
vi.mock('@/lib/activity-log', () => ({ actorFromAuth: async () => ({ actorType: 'admin', actorMemberId: 'admin-1' }), logActivity }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { member_id: 'm-1' } }) }
      return chain
    },
  }),
}))

const { POST } = await import('./route')

function post(body: unknown, slug = 'colorado') {
  return POST(
    new Request(`https://www.stellreducation.org/api/admin/events/${slug}/docusign-reissue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  requireEventAccess.mockResolvedValue({ ok: true, status: 200 })
})

describe('POST /api/admin/events/[slug]/docusign-reissue', () => {
  it('403s an event manager on an unassigned event', async () => {
    requireEventAccess.mockResolvedValue({ ok: false, status: 403 })
    expect((await post({ participantId: 'p-1' })).status).toBe(403)
    expect(reissue).not.toHaveBeenCalled()
  })

  it('scopes the lookup to the event and 404s a participant from another', async () => {
    reissue.mockResolvedValueOnce({ kind: 'not_found' })
    expect((await post({ participantId: 'p-1' }, 'texas')).status).toBe(404)
    expect(reissue).toHaveBeenCalledWith(expect.anything(), 'p-1', { eventSlug: 'texas', allowNewEnvelope: false })
  })

  it('409s with the reason before spending an envelope', async () => {
    reissue.mockResolvedValueOnce({ kind: 'needs_confirm', reason: 'voided', message: 'The last envelope was voided.' })
    const res = await post({ participantId: 'p-1' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ needsConfirm: 'voided' })
    expect(logActivity).not.toHaveBeenCalled()
  })

  it('passes confirmation through and logs the re-issue', async () => {
    reissue.mockResolvedValueOnce({ kind: 'reissued', outcome: 'issued' })
    const res = await post({ participantId: 'p-1', confirmNewEnvelope: true })
    expect(await res.json()).toEqual({ ok: true, action: 'reissued', outcome: 'issued' })
    expect(reissue).toHaveBeenCalledWith(expect.anything(), 'p-1', { eventSlug: 'colorado', allowNewEnvelope: true })
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'docusign_reissued', memberId: 'm-1' }), expect.anything())
  })

  it('resends and logs a live envelope', async () => {
    const res = await post({ participantId: 'p-1' })
    expect(await res.json()).toEqual({ ok: true, action: 'resent', recipients: 1 })
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'docusign_resent' }), expect.anything())
  })

  it('502s when DocuSign rejects the new envelope', async () => {
    reissue.mockResolvedValueOnce({ kind: 'reissued', outcome: 'failed' })
    expect((await post({ participantId: 'p-1', confirmNewEnvelope: true })).status).toBe(502)
  })
})
