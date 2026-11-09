import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommunityMember } from '@/lib/community'

// S5 B9: the IDOR snapshot accepts the coaching request write as Stellr-only because a
// workshop is a mentoring_cohorts row, which the database now holds to Stellr. So the id
// a member names has to be resolved against that table, as a coaching workshop.

const state = vi.hoisted(() => ({
  row: null as unknown,
  reads: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
}))
const notifyMember = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const filters: Array<[string, unknown]> = []
      state.reads.push({ table, filters })
      const builder: Record<string, unknown> = {}
      builder.select = () => builder
      builder.eq = (column: string, value: unknown) => {
        filters.push([column, value])
        return builder
      }
      builder.maybeSingle = async () => ({ data: table === 'mentoring_cohorts' ? state.row : null, error: null })
      return builder
    },
  }),
}))
vi.mock('@/lib/notify', () => ({ notifyMember, notifyMembers: vi.fn() }))
vi.mock('@/lib/activity-log', () => ({ logActivity: vi.fn(async () => undefined) }))
vi.mock('@/lib/sessions', () => ({ linkCohortTraining: vi.fn() }))
vi.mock('@/lib/member-roles', () => ({ addGlobalRole: vi.fn() }))
vi.mock('@/lib/compliance', () => ({ isClearedForMinorContact: vi.fn() }))
vi.mock('@/lib/entitlements', () => ({}))
vi.mock('@/lib/community-delete-guard', () => ({ assertCohortDeletable: vi.fn() }))
vi.mock('@/lib/stripe', () => ({ stripeClient: vi.fn() }))

import { requestSession } from '@/lib/coaching'

const member = { id: 'member-1', first_name: 'A', last_name: 'Member' } as unknown as CommunityMember

beforeEach(() => {
  state.row = null
  state.reads = []
  notifyMember.mockClear()
})

describe('requestSession', () => {
  it('resolves the workshop id against mentoring_cohorts, as a coaching workshop', async () => {
    state.row = { id: 'workshop-1', name: 'Workshop', mentor_member_id: 'coach-1', cohort_members: [] }

    expect(await requestSession(member, 'workshop-1', {})).toBe(true)

    const read = state.reads.find((r) => r.table === 'mentoring_cohorts')
    expect(read?.filters).toEqual(expect.arrayContaining([['id', 'workshop-1'], ['container_type', expect.any(String)]]))
    expect(notifyMember).toHaveBeenCalledWith('coach-1', expect.objectContaining({ referenceId: 'workshop-1' }))
  })

  it('notifies nobody for an id that is not a workshop', async () => {
    expect(await requestSession(member, 'not-a-workshop', {})).toBe(false)
    expect(notifyMember).not.toHaveBeenCalled()
  })
})
