// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review MEM-10 (safeguarding): notifyMentions must never email a minor an
// @mention, even if a stale directory opt-in or a hand-crafted body names one.
// deep review MEM-11: the fan-out is capped at MAX_MENTION_RECIPIENTS.
// deep review MEM-N2: a failed minor-backstop lookup fails CLOSED (no fan-out).
const { state } = vi.hoisted(() => ({
  state: {
    visible: [] as Array<{ member_id: string }>,
    members: [] as Array<{ id: string; date_of_birth: string | null; age_bracket: string | null }>,
    membersError: false,
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
        // Honour the .in() id list so the MEM-11 cap (which trims the id list
        // BEFORE this query) is observable: only queried ids come back.
        return {
          select: () => ({
            in: (_c: string, ids: string[]) => ({
              eq: async () => ({ data: state.visible.filter((r) => ids.includes(r.member_id)), error: null }),
            }),
          }),
        }
      }
      if (table === 'members') {
        return {
          select: () => ({
            in: async (_c: string, ids: string[]) =>
              state.membersError
                ? { data: null, error: { message: 'boom' } }
                : { data: state.members.filter((m) => ids.includes(m.id)), error: null },
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

import { notifyMentions } from './mentions'

beforeEach(() => {
  state.visible = []
  state.members = []
  state.membersError = false
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

describe('notifyMentions — fan-out cap (MEM-11)', () => {
  it('notifies at most 10 recipients even when 25 are mentioned', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `u${i}`)
    state.visible = ids.map((id) => ({ member_id: id }))
    state.members = ids.map((id) => ({ id, date_of_birth: '1990-01-01', age_bracket: 'adult' }))
    await notifyMentions({
      mentionIds: ids,
      actorMemberId: 'actor-9',
      actorName: 'Actor',
      context: 'post',
      postId: 'p1',
      spaceSlug: 'general',
    })
    expect(state.notified).toHaveLength(10)
  })
})

describe('notifyMentions — minor backstop fails closed (MEM-N2)', () => {
  it('sends to nobody when the recipient lookup errors', async () => {
    state.visible = [{ member_id: 'adult-1' }]
    state.membersError = true // the backstop can no longer prove nobody is a minor
    await notifyMentions({
      mentionIds: ['adult-1'],
      actorMemberId: 'actor-9',
      actorName: 'Actor',
      context: 'post',
      postId: 'p1',
      spaceSlug: 'general',
    })
    expect(state.notified).toEqual([])
  })
})
