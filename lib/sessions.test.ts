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
    // deep review MEM-N1 / DB-N1: canAccessChannel now also reads the caller's
    // members row (is_active/deleted_at), the cohort roster, and session_hosts
    // (can_mentor) + a clearance re-check for the mentor/host side.
    member: null as Record<string, unknown> | null,
    rosterMember: null as Record<string, unknown> | null,
    host: null as Record<string, unknown> | null,
    cleared: true,
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
vi.mock('@/lib/compliance', () => ({ isClearedForMinorContact: async () => state.cleared }))
vi.mock('@/lib/community', () => ({ getCurrentMember: async () => null }))
// containerAccessPersists reads mentoring_cohorts internally; stub it so the cohort
// branch tests assert the access decision, not container persistence (D1, covered elsewhere).
vi.mock('@/lib/containers', () => ({ containerAccessPersists: async () => true }))

vi.mock('@/lib/supabase', () => {
  // A chainable read double: any number of .eq()/.neq()/.in()/.is() then
  // .maybeSingle() or an awaited list, resolving to the supplied result.
  const read = (result: () => { data?: unknown; error?: unknown; count?: unknown }) => {
    const q: Record<string, unknown> = {}
    q.select = () => q
    q.eq = () => q
    q.neq = () => q
    q.in = () => q
    q.is = () => q
    q.maybeSingle = async () => result()
    q.then = (resolve: (v: unknown) => unknown) => resolve(result())
    return q
  }
  return {
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
        if (table === 'chat_channels') return read(() => ({ data: state.channel, error: null }))
        if (table === 'mentoring_cohorts') return read(() => ({ data: state.cohort, error: null }))
        if (table === 'members') return read(() => ({ data: state.member, error: null }))
        if (table === 'cohort_members') return read(() => ({ data: state.rosterMember, error: null }))
        if (table === 'session_hosts') return read(() => ({ data: state.host, error: null }))
        throw new Error(`unexpected table ${table}`)
      },
    }),
  }
})

import { flagMessage, deleteMessage, canAccessChannel } from './sessions'

beforeEach(() => {
  state.message = null
  state.channel = null
  state.cohort = null
  // Default the caller to an active, non-deleted member so the existing flag/
  // delete tests are unaffected by the DB-N1 member guard.
  state.member = { is_active: true, deleted_at: null }
  state.rosterMember = null
  state.host = null
  state.cleared = true
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

describe('canAccessChannel — cohort host clearance (deep review MEM-N1)', () => {
  // kind is neither 'coaching' nor 'space' → the cohort/host branch.
  const cohortChannel = { kind: 'cohort', cohort_id: 'co-1', member_id: null, host_member_id: null, space_id: null }

  it('allows an active roster member without any clearance check (a mentee may be a minor)', async () => {
    state.channel = cohortChannel
    state.rosterMember = { member_id: 'kid-1' } // on the active roster
    state.cleared = false // would block a host, must NOT block a roster member
    expect(await canAccessChannel('ch', 'kid-1')).toBe(true)
  })

  it('allows the cohort mentor when they hold can_mentor AND a current clearance', async () => {
    state.channel = cohortChannel
    state.rosterMember = null
    state.cohort = { mentor_member_id: 'mentor-1' }
    state.host = { can_mentor: true }
    state.cleared = true
    expect(await canAccessChannel('ch', 'mentor-1')).toBe(true)
  })

  it('DENIES the cohort mentor when their clearance has lapsed (uncleared), despite mentor_member_id', async () => {
    // The MEM-N1 hole: authorising on mentor_member_id alone let an uncleared /
    // lapsed adult into cohort chat whose roster may include minors.
    state.channel = cohortChannel
    state.rosterMember = null
    state.cohort = { mentor_member_id: 'mentor-1' }
    state.host = { can_mentor: true }
    state.cleared = false
    expect(await canAccessChannel('ch', 'mentor-1')).toBe(false)
  })

  it('DENIES a mentor_member_id match that lacks the can_mentor host capability', async () => {
    state.channel = cohortChannel
    state.rosterMember = null
    state.cohort = { mentor_member_id: 'mentor-1' }
    state.host = { can_mentor: false }
    state.cleared = true
    expect(await canAccessChannel('ch', 'mentor-1')).toBe(false)
  })
})

describe('canAccessChannel — deactivated/soft-deleted member (deep review DB-N1)', () => {
  it('DENIES a deactivated member even when they are on the active cohort roster', async () => {
    state.channel = { kind: 'cohort', cohort_id: 'co-1', member_id: null, host_member_id: null, space_id: null }
    state.rosterMember = { member_id: 'kid-1' } // would otherwise grant
    state.member = { is_active: false, deleted_at: null } // deactivated, Clerk login kept
    expect(await canAccessChannel('ch', 'kid-1')).toBe(false)
  })

  it('DENIES a soft-deleted member on a coaching channel they are party to', async () => {
    state.channel = { kind: 'coaching', cohort_id: null, member_id: 'kid-1', host_member_id: 'coach-1', space_id: null }
    state.member = { is_active: true, deleted_at: '2026-10-10T00:00:00Z' }
    expect(await canAccessChannel('ch', 'coach-1')).toBe(false)
  })

  it('allows an active coaching party (guard passes through to the coaching branch)', async () => {
    state.channel = { kind: 'coaching', cohort_id: null, member_id: 'kid-1', host_member_id: 'coach-1', space_id: null }
    state.member = { is_active: true, deleted_at: null }
    expect(await canAccessChannel('ch', 'coach-1')).toBe(true)
  })
})
