// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// S5 B9: the IDOR snapshot accepts this write as Stellr-only because a lesson hangs off
// training_modules, which the database now holds to Stellr. So the route has to resolve
// the id through training_items and read the module by that link.

const state = vi.hoisted(() => ({
  item: null as unknown,
  reads: [] as Array<{ table: string; columns?: string; filters: Array<[string, unknown]> }>,
}))
const notifyCommunityAdmins = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const read: { table: string; columns?: string; filters: Array<[string, unknown]> } = { table, filters: [] }
      state.reads.push(read)
      const builder: Record<string, unknown> = {}
      builder.select = (columns: string) => {
        read.columns = columns
        return builder
      }
      builder.eq = (column: string, value: unknown) => {
        read.filters.push([column, value])
        return builder
      }
      builder.maybeSingle = async () => ({ data: state.item, error: null })
      return builder
    },
  }),
}))
vi.mock('@/lib/onboarded-member', () => ({
  getOnboardedMember: async () => ({ id: 'member-1', first_name: 'A', last_name: 'Member', email: null }),
}))
vi.mock('@/lib/notify', () => ({ notifyCommunityAdmins }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))

const { POST } = await import('./route')

function flag(itemId: string) {
  return POST(new Request(`https://app.test/api/community/training/${itemId}/flag`, { method: 'POST' }), {
    params: Promise.resolve({ itemId }),
  })
}

beforeEach(() => {
  state.item = null
  state.reads = []
  notifyCommunityAdmins.mockClear()
})

describe('POST /api/community/training/[itemId]/flag', () => {
  it('finds the lesson by id and takes its module through the link', async () => {
    state.item = { id: 'item-1', title: 'Lesson', module_id: 'module-1', training_modules: { title: 'Course' } }
    const res = await flag('item-1')

    expect(res.status).toBe(200)
    expect(state.reads).toHaveLength(1)
    expect(state.reads[0].table).toBe('training_items')
    expect(state.reads[0].columns).toContain('training_modules(title)')
    expect(state.reads[0].filters).toEqual([['id', 'item-1']])
    expect(notifyCommunityAdmins).toHaveBeenCalledWith(expect.objectContaining({ referenceId: 'item-1' }))
  })

  it('notifies nobody for an id that is not a lesson', async () => {
    const res = await flag('not-a-lesson')

    expect(res.status).toBe(404)
    expect(notifyCommunityAdmins).not.toHaveBeenCalled()
  })
})
