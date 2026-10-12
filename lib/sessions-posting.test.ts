// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// deep review MEM-7 (listMessages newest-first) and MEM-8 (space chat obeys mute /
// posting suspension / moderators-only). These exercise sessions.ts against the
// REAL spaces resolver, so a space channel's posting rules are the live ones.
const { state } = vi.hoisted(() => ({
  state: { db: null as FakeDb | null, member: null as Record<string, unknown> | null },
}))

vi.mock('@/lib/community', () => ({ getCurrentMember: async () => state.member }))
vi.mock('@/lib/notify', () => ({ notifyMember: async () => {}, notifyMembers: async () => {}, notifyCommunityAdmins: async () => {} }))
vi.mock('@/lib/activity-log', () => ({ logActivity: async () => {} }))
vi.mock('@/lib/compliance', () => ({ isClearedForMinorContact: async () => true }))
vi.mock('@/lib/containers', () => ({ containerAccessPersists: async () => true }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => state.db!.client }))

const { listMessages, canAccessChannel, canPostToChannel } = await import('./sessions')

beforeEach(() => {
  vi.clearAllMocks()
  state.member = { id: 'm1', isAdmin: false, activeTierIds: [] }
})

describe('listMessages — newest 500 (MEM-7)', () => {
  it('returns the newest messages (not the oldest) when a channel exceeds 500', () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({
      id: `msg-${i}`,
      body: `m${i}`,
      author_member_id: 'm1',
      created_at: String(i).padStart(4, '0'), // lexicographic == chronological here
      flagged_at: null,
      deleted_at: null,
      channel_id: 'ch',
    }))
    state.db = fakeSupabase({ chat_messages: rows })
    return listMessages('ch').then((out) => {
      expect(out).toHaveLength(500)
      expect(out.some((m) => m.id === 'msg-500')).toBe(true) // newest present
      expect(out.some((m) => m.id === 'msg-0')).toBe(false) // oldest dropped
      // returned in chronological (ascending) order for the UI
      expect(out[out.length - 1].id).toBe('msg-500')
    })
  })
})

describe('canPostToChannel — space chat sanctions (MEM-8)', () => {
  function seedSpace(opts: { posting_policy?: 'all' | 'moderators'; muted?: boolean; role?: string } = {}) {
    const roster = opts.muted || opts.role
      ? [{ space_id: 'sp1', member_id: 'm1', role: opts.role ?? 'member', status: 'active', muted: !!opts.muted }]
      : []
    state.db = fakeSupabase({
      chat_channels: [{ id: 'ch', kind: 'space', space_id: 'sp1', cohort_id: null, member_id: null, host_member_id: null }],
      members: [{ id: 'm1', is_active: true, deleted_at: null }],
      community_spaces: [{ id: 'sp1', slug: 'general', access_type: 'open', is_archived: false, posting_policy: opts.posting_policy ?? 'all', allow_member_uploads: true }],
      community_space_members: roster,
    })
  }

  it('lets a muted member READ the space chat but NOT post', async () => {
    seedSpace({ muted: true })
    expect(await canAccessChannel('ch', 'm1')).toBe(true) // read still allowed
    expect(await canPostToChannel('ch', 'm1')).toBe(false) // posting blocked
  })

  it('allows posting when not muted and the policy is open', async () => {
    seedSpace({})
    expect(await canPostToChannel('ch', 'm1')).toBe(true)
  })

  it('blocks a non-moderator when the space is moderators-only', async () => {
    seedSpace({ posting_policy: 'moderators' })
    expect(await canAccessChannel('ch', 'm1')).toBe(true)
    expect(await canPostToChannel('ch', 'm1')).toBe(false)
  })
})
