// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// S1 monitoring: the check-in route answers a failed write, or a view that does
// not load after a match, with its own 500, which never reaches Next's
// onRequestError. It reports both to app_errors (lib/app-errors reportError)
// under the fixed label, never the event slug. The response is unchanged, and
// the guardian-consent refusal (a 403) is not an error.

const h = vi.hoisted(() => ({
  reportError: vi.fn(async (_err: unknown, _opts: { route: string }) => {}),
  updateError: null as { code: string; message: string } | null,
  view: { firstName: 'x', lastName: 'y' } as Record<string, unknown> | null,
}))

vi.mock('@/lib/app-errors', () => ({ reportError: h.reportError }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        neq: () => chain,
        is: () => chain,
        update: () => chain,
        maybeSingle: async () => ({
          data: table === 'event_settings' ? { check_in_token: 'tok-placeholder', check_in_open: true } : null,
          error: null,
        }),
        then: (onF: (v: unknown) => unknown) =>
          Promise.resolve({
            data: table === 'registrations'
              ? [{ participants: [{ id: 'p1', first_name: 'Alex', last_name: 'Smith', nickname: null, date_of_birth: '2011-04-09', email: 'family@example.test', checked_in_at: null }] }]
              : null,
            error: table === 'participants' ? h.updateError : null,
          }).then(onF),
      }
      return chain
    },
  }),
}))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: async () => ({ setting: 'in_person' }) }))
vi.mock('@/lib/rate-limit-async', () => ({
  rateLimit: async () => null,
  limit: async () => ({ ok: true, retryAfterSeconds: 0 }),
}))
vi.mock('@/lib/check-in-view', () => ({ loadCheckInView: async () => h.view }))

const { POST } = await import('./route')

const SORRY = { error: 'Something went wrong. Please see the registration desk.' }
const post = () =>
  POST(new Request('https://www.example.test/api/check-in', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'some-event', token: 'tok-placeholder', email: 'family@example.test' }),
  }))

beforeEach(() => {
  vi.clearAllMocks()
  h.updateError = null
  h.view = { firstName: 'x', lastName: 'y' }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/check-in reports its own 500s', () => {
  it('a failed check-in write: reported under the fixed label, the 500 sent unchanged', async () => {
    h.updateError = { code: '57014', message: 'canceling statement due to statement timeout' }
    const res = await post()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual(SORRY)
    expect(h.reportError).toHaveBeenCalledTimes(1)
    const [err, opts] = h.reportError.mock.calls[0]
    expect((err as Error).message).toContain('canceling statement due to statement timeout')
    expect(opts).toEqual({ route: 'POST /api/check-in' })
  })

  it('a view that does not load after a match: reported, the 500 sent unchanged', async () => {
    h.view = null
    const res = await post()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual(SORRY)
    expect(h.reportError).toHaveBeenCalledWith(expect.any(Error), { route: 'POST /api/check-in' })
  })

  it("the guardian-consent refusal is a 403, not an error", async () => {
    h.updateError = { code: '23514', message: 'guardian_consent_pending' }
    const res = await post()
    expect(res.status).toBe(403)
    expect(h.reportError).not.toHaveBeenCalled()
  })

  it('a check-in that succeeds reports nothing', async () => {
    expect((await post()).status).toBe(200)
    expect(h.reportError).not.toHaveBeenCalled()
  })
})
