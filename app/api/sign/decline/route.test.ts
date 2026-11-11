// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// POST /api/sign/decline. S5 wave 6: another organiser's envelope (a guardian
// declining a tenant's consent) does not land in Stellr's admin alerts with its
// names and reason; Stellr's own declines still do.

const h = vi.hoisted(() => ({
  envelope: { id: 'agr-1', tenant_id: null as string | null, minor_name: 'Kit Id', signer_name: 'Pat Id', event_title: 'Cup', participant_id: 'p-1' },
  decline: vi.fn(async () => {}),
  notify: vi.fn(async (_o: unknown) => {}),
}))

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({}) }))
vi.mock('@/lib/esign/native/flow', () => ({ declineAgreement: h.decline }))
vi.mock('@/lib/notify', () => ({ notifyCommunityAdmins: h.notify }))
vi.mock('@/lib/esign/native/http', async (orig) => ({
  ...(await orig<typeof import('@/lib/esign/native/http')>()),
  throttle: async () => null,
  sameOrigin: () => true,
  actingSession: async () => ({ recipient: { name: 'Pat Id' }, envelope: h.envelope }),
  readJson: async () => ({ reason: 'No thanks' }),
}))

const { POST } = await import('./route')

const post = () => POST(new Request('https://www.stellreducation.org/api/sign/decline', { method: 'POST', body: '{}' }))

beforeEach(() => vi.clearAllMocks())

describe('POST /api/sign/decline', () => {
  it('Stellr’s envelope: declined, and admins are told', async () => {
    h.envelope.tenant_id = null
    expect((await post()).status).toBe(200)
    expect(h.decline).toHaveBeenCalledTimes(1)
    expect(h.notify).toHaveBeenCalledTimes(1)
  })

  it('another organiser’s envelope: declined, and Stellr’s admins are not told', async () => {
    h.envelope.tenant_id = 'c0000000-0000-4000-8000-0000000000aa'
    expect((await post()).status).toBe(200)
    expect(h.decline).toHaveBeenCalledTimes(1)
    expect(h.notify).not.toHaveBeenCalled()
  })
})
