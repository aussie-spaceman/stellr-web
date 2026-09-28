import { describe, it, expect, vi, beforeEach } from 'vitest'

// 28 Sept 2026: this route answered 200 and logged "issued" while DocuSign was
// rejecting every envelope (ACCOUNT_LACKS_EXTENSIONS_PERMISSIONS). The admin saw
// nothing wrong and the activity log recorded agreements that were never sent.

const { dispatch, logActivity } = vi.hoisted(() => ({
  dispatch: vi.fn(async (_db: unknown, _m: unknown, _o: unknown): Promise<string> => 'issued'),
  logActivity: vi.fn(async (_entry: unknown, _db: unknown) => {}),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ sessionClaims: { admin: true } }) }))
vi.mock('@/lib/admin-auth', () => ({ isAdminClaims: (c: { admin?: boolean } | null) => !!c?.admin }))
vi.mock('@/lib/volunteer', () => ({ dispatchVolunteerAgreement: dispatch, VOLUNTEER_PROGRAM_TITLE: 'Stellr Volunteer Program' }))
vi.mock('@/lib/activity-log', () => ({ actorFromAuth: async () => ({ actorType: 'admin' }), logActivity }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: { id: 'm-1', first_name: 'Pat', last_name: 'Eaton', email: 'pat@example.org', phone: null, date_of_birth: null } }),
      }
      return chain
    },
  }),
}))

const { POST } = await import('./route')
const post = () => POST(new Request('https://app.stellreducation.org/x', { method: 'POST' }), { params: Promise.resolve({ id: 'm-1' }) })

beforeEach(() => vi.clearAllMocks())

describe('POST /api/admin/members/[id]/volunteer-agreement', () => {
  it('reports a DocuSign rejection as an error and logs nothing', async () => {
    dispatch.mockResolvedValueOnce('failed')
    const res = await post()
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/nothing was sent/)
    expect(logActivity).not.toHaveBeenCalled()
  })

  it('logs "issued" only when an envelope actually went out', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect((await res.json()).agreement).toBe('issued')
    expect((logActivity.mock.calls[0][0] as { action: string }).action).toBe('volunteer_agreement_issued')
  })

  it('records on-file coverage as such, not as a new issue', async () => {
    dispatch.mockResolvedValueOnce('on_file')
    await post()
    expect((logActivity.mock.calls[0][0] as { action: string }).action).toBe('volunteer_agreement_on_file')
  })
})
