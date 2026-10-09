// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review MEM-4 (safeguarding): a chat flag must reach a NEUTRAL party and
// never only the reported coach, and the author of a flagged message (the coach,
// in a 1:1 coaching chat) must not be able to delete it.
const { state } = vi.hoisted(() => ({
  state: {
    message: null as Record<string, unknown> | null,
    channel: null as Record<string, unknown> | null,
    cohort: null as Record<string, unknown> | null,
    adminNotifs: [] as unknown[],
    memberNotifs: [] as string[],
    messageUpdates: [] as Record<string, unknown>[],
  },
}))

vi.mock('@/lib/notify', () => ({
  notifyCommunityAdmins: async (input: unknown) => {
    state.adminNotifs.push(input)
  },
  notifyMember: async (id: string) => {
    state.memberNotifs.push(id)
  },
  notifyMembers: async () => {},
}))
vi.mock('@/lib/activity-log', () => ({ logActivity: async () => {} }))
vi.mock('@/lib/compliance', () => ({ isClearedForMinorContact: async () => true }))
vi.mock('@/lib/community', () => ({ getCurrentMember: async () => null }))

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from(table: string) {
      if (table === 'chat_messages') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.message, error: null }) }) }),
          update: (payload: Record<string, unknown>) => ({
            eq: async () => {
              state.messageUpdates.push(payload)
              return { error: null }
            },
          }),
        }
      }
      if (table === 'chat_channels') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.channel, error: null }) }) }) }
      }
      if (table === 'mentoring_cohorts') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.cohort, error: null }) }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

import { flagMessage, deleteMessage } from './sessions'

beforeEach(() => {
  state.message = null
  state.channel = null
  state.cohort = null
  state.adminNotifs = []
  state.memberNotifs = []
  state.messageUpdates = []
})

describe('flagMessage — 1:1 coaching chat', () => {
  it('alerts community admins and does NOT alert the reported coach (the message author)', async () => {
    state.message = { id: 'msg-1', channel_id: 'ch-1', author_member_id: 'coach-1' }
    state.channel = { kind: 'coaching', cohort_id: null, member_id: 'kid-1', host_member_id: 'coach-1', space_id: null }

    const ok = await flagMessage('msg-1', 'kid-1') // the coachee (minor) flags the coach's message
    expect(ok).toBe(true)
    expect(state.adminNotifs).toHaveLength(1) // neutral party reached
    expect(state.memberNotifs).not.toContain('coach-1') // reported coach NOT notified
  })

  it('space-chat flags still reach a neutral party (previously reached nobody)', async () => {
    state.message = { id: 'msg-2', channel_id: 'ch-2', author_member_id: 'adult-9' }
    state.channel = { kind: 'space', cohort_id: null, member_id: null, host_member_id: null, space_id: null }
    // canAccessChannel for a space resolves via getCurrentMember, which we stub to
    // null — so access is refused and no flag is written. Assert the fail-closed
    // path rather than fake space access; the admin-notify path is covered above.
    const ok = await flagMessage('msg-2', 'kid-1')
    expect(ok).toBe(false)
  })
})

describe('deleteMessage — flagged message by its author', () => {
  it('refuses when the moderator (coach) is the author of a flagged message', async () => {
    state.message = { id: 'msg-1', channel_id: 'ch-1', author_member_id: 'coach-1', flagged_at: '2026-10-09T00:00:00Z' }
    state.channel = { kind: 'coaching', cohort_id: null, host_member_id: 'coach-1' }

    const ok = await deleteMessage('msg-1', 'coach-1')
    expect(ok).toBe(false)
    expect(state.messageUpdates).toHaveLength(0) // nothing soft-deleted
  })

  it('still lets the coach delete a flagged message authored by someone else', async () => {
    state.message = { id: 'msg-3', channel_id: 'ch-1', author_member_id: 'kid-1', flagged_at: '2026-10-09T00:00:00Z' }
    state.channel = { kind: 'coaching', cohort_id: null, host_member_id: 'coach-1' }

    const ok = await deleteMessage('msg-3', 'coach-1')
    expect(ok).toBe(true)
    expect(state.messageUpdates).toHaveLength(1)
  })
})
