// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review MEM-10 (safeguarding): a minor must not be able to opt INTO the
// member directory. Opting out stays allowed.
const { state } = vi.hoisted(() => ({
  state: { member: null as Record<string, unknown> | null, upserts: 0 },
}))

vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/community', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/community')>()
  return { ...actual, getCurrentMember: async () => state.member }
})
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => ({
      upsert: async () => {
        state.upserts += 1
        return { error: null }
      },
    }),
  }),
}))

const { PATCH } = await import('./route')

const patch = (body: unknown) =>
  PATCH(new Request('http://localhost/api/members/directory-prefs', { method: 'PATCH', body: JSON.stringify(body) }))

beforeEach(() => {
  state.member = null
  state.upserts = 0
})

describe('PATCH /api/members/directory-prefs — minor opt-in gate', () => {
  it('refuses a minor (high-school) opting in, and writes nothing', async () => {
    state.member = { id: 'kid-1', date_of_birth: '2011-01-01', age_bracket: 'high_school' }
    const res = await patch({ is_visible: true })
    expect(res.status).toBe(403)
    expect(state.upserts).toBe(0)
  })

  it('lets an adult opt in', async () => {
    state.member = { id: 'adult-1', date_of_birth: '1990-01-01', age_bracket: 'adult' }
    const res = await patch({ is_visible: true })
    expect(res.status).toBe(200)
    expect(state.upserts).toBe(1)
  })

  it('still lets a minor opt OUT (is_visible:false)', async () => {
    state.member = { id: 'kid-1', date_of_birth: '2011-01-01', age_bracket: 'high_school' }
    const res = await patch({ is_visible: false })
    expect(res.status).toBe(200)
  })
})
