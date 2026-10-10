// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// deep review BG-5: removing a volunteer must also tear down the event-Space
// access they inherited on assignment (syncObjectSpaceRoster + the Volunteer
// role), not just the cohort/participation rows — otherwise the removed (often
// uncleared) volunteer keeps Space/chat access to an event that may be full of
// minors, and reconcileEventSpaceRoster re-grants it on the next registration.
// We assert the DELETE handler delegates to removeEventParticipation (the same
// helper the participant-DELETE and hard-delete paths use).

const removeEventParticipation = vi.fn(async () => {})

vi.mock('@/lib/event-access', () => ({ requireEventAccess: async () => ({ ok: true }) }))
vi.mock('@/lib/event-participation-sync', () => ({ removeEventParticipation }))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: async () => ({ title: 'Colorado SDC' }) }))
vi.mock('@/lib/container-sync', () => ({ ensureEventContainer: async () => 'container-1' }))
vi.mock('@/lib/space-inheritance', () => ({ syncObjectSpaceRoster: async () => {} }))
vi.mock('@/lib/volunteer', () => ({
  getVolunteerStatuses: async () => ({}),
  grantVolunteerRole: async () => {},
  dispatchVolunteerAgreement: async () => 'linked',
  VOLUNTEER_MEMBER_COLUMNS: 'id',
}))
vi.mock('@/lib/activity-log', () => ({ logActivity: async () => {}, actorFromAuth: async () => ({}) }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'in', 'neq', 'delete', 'update']) chain[m] = () => chain
      // eventContainerId resolves the event-level container.
      chain.maybeSingle = async () => ({ data: table === 'mentoring_cohorts' ? { id: 'container-1' } : null, error: null })
      chain.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(r)
      return chain
    },
  }),
}))

const { DELETE } = await import('./route')

const del = (memberId: string) =>
  DELETE(
    new Request('https://app.test/api/admin/events/colorado/volunteers', {
      method: 'DELETE',
      body: JSON.stringify({ memberId }),
    }),
    { params: Promise.resolve({ slug: 'colorado' }) },
  )

beforeEach(() => {
  removeEventParticipation.mockClear()
})

describe('DELETE /api/admin/events/[slug]/volunteers (deep review BG-5)', () => {
  it('revokes the inherited event-Space access via removeEventParticipation', async () => {
    const res = await del('mem-9')
    expect(res.status).toBe(200)
    expect(removeEventParticipation).toHaveBeenCalledWith(
      expect.anything(),
      { memberId: 'mem-9', eventSlug: 'colorado' },
    )
  })

  it('rejects a request with no memberId (400) and tears nothing down', async () => {
    const res = await del('')
    expect(res.status).toBe(400)
    expect(removeEventParticipation).not.toHaveBeenCalled()
  })
})
