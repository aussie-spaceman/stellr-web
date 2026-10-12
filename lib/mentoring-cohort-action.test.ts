// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// deep review MEM-11: assignCohortAction must only ever target members on THIS
// cohort's active roster. An explicit memberIds list is intersected with the
// roster; an arbitrary id (outside the cohort) is dropped, so a mentor can't
// assign actions — or fire the notification emails — to non-cohort members.
const { state } = vi.hoisted(() => ({ state: { db: null as FakeDb | null, notified: [] as string[] } }))

vi.mock('@/lib/notify', () => ({
  notifyMembers: async (ids: string[]) => {
    state.notified.push(...ids)
  },
}))
vi.mock('@/lib/compliance', () => ({ isClearedForMinorContact: async () => true }))
vi.mock('@/lib/member-roles', () => ({ addGlobalRole: async () => ({ ok: true }) }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => state.db!.client }))

const { assignCohortAction } = await import('./mentoring')

beforeEach(() => {
  vi.clearAllMocks()
  state.notified = []
  state.db = fakeSupabase({
    cohort_members: [
      { cohort_id: 'co-1', member_id: 'in-1', status: 'active' },
      { cohort_id: 'co-1', member_id: 'in-2', status: 'active' },
      { cohort_id: 'co-1', member_id: 'left-3', status: 'removed' },
    ],
    mentoring_cohorts: [{ id: 'co-1', name: 'Cohort One' }],
    session_actions: [],
  })
})

describe('assignCohortAction — roster scoping (MEM-11)', () => {
  it('drops ids that are not on the active roster', async () => {
    const n = await assignCohortAction('co-1', 'mentor-1', {
      title: 'Do the thing',
      memberIds: ['in-1', 'outsider-9', 'left-3'], // only in-1 is active on this cohort
    })
    expect(n).toBe(1)
    const rows = state.db!.table('session_actions')
    expect(rows.map((r) => r.member_id)).toEqual(['in-1'])
    expect(state.notified).toEqual(['in-1']) // the outsider is never emailed
  })

  it('assigns to the whole active roster when no ids are given', async () => {
    const n = await assignCohortAction('co-1', 'mentor-1', { title: 'All hands' })
    expect(n).toBe(2)
    expect(state.db!.table('session_actions').map((r) => r.member_id).sort()).toEqual(['in-1', 'in-2'])
  })
})
