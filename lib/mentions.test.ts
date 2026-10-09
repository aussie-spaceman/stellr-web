// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review MEM-10 (safeguarding): notifyMentions must never email a minor an
// @mention, even if a stale directory opt-in or a hand-crafted body names one.
const { state } = vi.hoisted(() => ({
  state: {
    visible: [] as Array<{ member_id: string }>,
    members: [] as Array<{ id: string; date_of_birth: string | null; age_bracket: string | null }>,
    notified: [] as string[],
  },
}))

vi.mock('@/lib/notify', () => ({
  notifyMember: async (id: string) => {
    state.notified.push(id)
  },
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from(table: string) {
      if (table === 'member_directory_prefs') {
        return { select: () => ({ in: () => ({ eq: async () => ({ data: state.visible, error: null }) }) }) }
      }
      if (table === 'members') {
        return { select: () => ({ in: async () => ({ data: state.members, error: null }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

import { notifyMentions } from './mentions'

beforeEach(() => {
  state.visible = []
  state.members = []
  state.notified = []
})

describe('notifyMentions — minors are never notified', () => {
  it('drops a minor recipient and notifies only the adult', async () => {
    state.visible = [{ member_id: 'adult-1' }, { member_id: 'minor-2' }]
    state.members = [
      { id: 'adult-1', date_of_birth: '1990-01-01', age_bracket: 'adult' },
      { id: 'minor-2', date_of_birth: '2011-01-01', age_bracket: 'high_school' },
    ]
    await notifyMentions({
      mentionIds: ['adult-1', 'minor-2'],
      actorMemberId: 'actor-9',
      actorName: 'Actor',
      context: 'post',
      postId: 'p1',
      spaceSlug: 'general',
    })
    expect(state.notified).toEqual(['adult-1'])
  })
})
