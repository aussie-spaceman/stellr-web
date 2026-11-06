// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// What a member may name in a report or a reaction: content they can see, by the
// rules the pages render it by. A small table-backed client, so the real
// getSpaceAccessById and resolveSpaceAccess decide.

vi.mock('server-only', () => ({}))

type Row = Record<string, unknown>
let tables: Record<string, Row[]>
let failingReads: string[]

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = []
      const matched = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
      const failed = () => (failingReads.includes(table) ? { data: null, error: { message: 'read failed' } } : null)
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
        is: () => q,
        not: (c: string) => (filters.push((r) => r[c] != null), q),
        order: () => q,
        limit: () => q,
        range: () => q,
        maybeSingle: async () => failed() ?? { data: matched()[0] ?? null, error: null },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(failed() ?? { data: matched(), error: null }).then(resolve),
      }
      return q
    },
  }),
}))

import { memberCanSeeComment, memberCanSeePost } from './spaces'
import { isStandaloneLibraryFile, memberCanSeeResource } from './resources-catalogue'
import type { CommunityMember } from './community'

const member = (over: Partial<CommunityMember> = {}) =>
  ({ id: 'me', isAdmin: false, activeTierIds: [], hasPaidTier: false, ...over }) as CommunityMember
const admin = member({ isAdmin: true })

const OPEN = { id: 'open', slug: 'open', name: 'Open', access_type: 'open', is_archived: false }
const SECRET = { id: 'secret', slug: 'secret', name: 'Secret', access_type: 'secret', is_archived: false }
const ARCHIVED = { id: 'gone', slug: 'gone', name: 'Gone', access_type: 'open', is_archived: true }

beforeEach(() => {
  failingReads = []
  tables = {
    community_spaces: [OPEN, SECRET, ARCHIVED],
    community_posts: [
      { id: 'p-open', status: 'published', space_id: 'open' },
      { id: 'p-hidden', status: 'hidden', space_id: 'open' },
      { id: 'p-secret', status: 'published', space_id: 'secret' },
      { id: 'p-archived', status: 'published', space_id: 'gone' },
    ],
    community_comments: [
      { id: 'c-open', status: 'published', post_id: 'p-open' },
      { id: 'c-hidden', status: 'hidden', post_id: 'p-open' },
      { id: 'c-deleted', status: 'deleted', post_id: 'p-open' },
      { id: 'c-secret', status: 'published', post_id: 'p-secret' },
    ],
    community_resources: [
      { id: 'r-direct-open', space_id: 'open', event_ref: null },
      { id: 'r-direct-secret', space_id: 'secret', event_ref: null },
      { id: 'r-standalone', space_id: null, event_ref: null },
      { id: 'r-event', space_id: null, event_ref: 'some-event' },
      { id: 'r-cohort', space_id: null, event_ref: null },
      { id: 'r-other-cohort', space_id: null, event_ref: null },
      { id: 'r-recording', space_id: null, event_ref: null },
      { id: 'r-recording-other', space_id: null, event_ref: null },
    ],
    container_contents: [
      { container_id: 'cohort-mine', content_ref: 'r-cohort', content_type: 'resource' },
      { container_id: 'cohort-other', content_ref: 'r-cohort', content_type: 'resource' },
      { container_id: 'cohort-other', content_ref: 'r-other-cohort', content_type: 'resource' },
      { container_id: 'cohort-mine', content_ref: 'r-recording', content_type: 'recording' },
      { container_id: 'cohort-other', content_ref: 'r-recording-other', content_type: 'recording' },
    ],
    cohort_members: [
      {
        member_id: 'me',
        status: 'active',
        mentoring_cohorts: { id: 'cohort-mine', name: 'Mine', container_type: 'mentoring', campaign_ref: null, lifecycle: 'active' },
      },
    ],
  }
})

describe('memberCanSeePost', () => {
  it('a published post in a space the member can enter', async () => {
    expect(await memberCanSeePost(member(), 'p-open')).toBe(true)
  })

  it('not in a space the member cannot enter, or an archived one', async () => {
    expect(await memberCanSeePost(member(), 'p-secret')).toBe(false)
    expect(await memberCanSeePost(member(), 'p-archived')).toBe(false)
  })

  it('a roster member of the private space does see it', async () => {
    tables.community_space_members = [{ space_id: 'secret', member_id: 'me', role: 'member', status: 'active', muted: false }]
    expect(await memberCanSeePost(member(), 'p-secret')).toBe(true)
  })

  it('a tier that grants the space does too', async () => {
    tables.community_space_tiers = [{ space_id: 'secret', tier_id: 't1' }]
    expect(await memberCanSeePost(member({ activeTierIds: ['t1'] }), 'p-secret')).toBe(true)
  })

  it('a moderated post: hidden from members, shown to an admin', async () => {
    expect(await memberCanSeePost(member(), 'p-hidden')).toBe(false)
    expect(await memberCanSeePost(admin, 'p-hidden')).toBe(true)
  })

  it('an id that does not exist', async () => {
    expect(await memberCanSeePost(member(), 'missing')).toBe(false)
    expect(await memberCanSeePost(admin, 'missing')).toBe(false)
  })
})

describe('memberCanSeeComment', () => {
  it('a published comment on a visible post', async () => {
    expect(await memberCanSeeComment(member(), 'c-open')).toBe(true)
  })

  it('not on a post the member cannot see', async () => {
    expect(await memberCanSeeComment(member(), 'c-secret')).toBe(false)
  })

  it('a hidden comment: admins only', async () => {
    expect(await memberCanSeeComment(member(), 'c-hidden')).toBe(false)
    expect(await memberCanSeeComment(admin, 'c-hidden')).toBe(true)
  })

  it('a deleted comment: nobody', async () => {
    expect(await memberCanSeeComment(admin, 'c-deleted')).toBe(false)
  })

  it('an id that does not exist', async () => {
    expect(await memberCanSeeComment(admin, 'missing')).toBe(false)
  })
})

describe('memberCanSeeResource', () => {
  it('a file uploaded to a space follows the space', async () => {
    expect(await memberCanSeeResource(member(), 'r-direct-open')).toBe(true)
    expect(await memberCanSeeResource(member(), 'r-direct-secret')).toBe(false)
  })

  it('a standalone library file is open to members', async () => {
    expect(await memberCanSeeResource(member(), 'r-standalone')).toBe(true)
  })

  it('an event material with no attachment is not reached this way', async () => {
    expect(await memberCanSeeResource(member(), 'r-event')).toBe(false)
  })

  it('a file moderation has resolved a report of in a container is not a library file', async () => {
    tables.community_flags = [{ id: 'f1', content_type: 'resource', content_id: 'r-standalone', status: 'resolved', viewed_in_container: 'cohort-other' }]
    expect(await memberCanSeeResource(member(), 'r-standalone')).toBe(false)
    expect(await isStandaloneLibraryFile('r-standalone')).toBe(false)
  })

  it.each(['container_contents', 'community_flags'])('a library file is not seen when the %s read fails', async (table) => {
    expect(await isStandaloneLibraryFile('r-standalone')).toBe(true)
    failingReads = [table]
    expect(await isStandaloneLibraryFile('r-standalone')).toBe(false)
    expect(await memberCanSeeResource(member(), 'r-standalone')).toBe(false)
  })

  it('a file or recording in a container the member is in', async () => {
    expect(await memberCanSeeResource(member(), 'r-cohort')).toBe(true)
    expect(await memberCanSeeResource(member(), 'r-recording', 'cohort-mine')).toBe(true)
  })

  it('not a recording only in someone else’s container', async () => {
    expect(await memberCanSeeResource(member(), 'r-recording-other')).toBe(false)
    expect(await memberCanSeeResource(member(), 'r-recording-other', 'cohort-mine')).toBe(false)
  })

  it('not a file only in someone else’s container', async () => {
    expect(await memberCanSeeResource(member(), 'r-other-cohort')).toBe(false)
  })

  it('the container named must hold the file and be the member’s', async () => {
    expect(await memberCanSeeResource(member(), 'r-cohort', 'cohort-mine')).toBe(true)
    expect(await memberCanSeeResource(member(), 'r-cohort', 'cohort-other')).toBe(false)
    expect(await memberCanSeeResource(member(), 'r-standalone', 'cohort-mine')).toBe(false)
    expect(await memberCanSeeResource(member(), 'r-other-cohort', 'cohort-mine')).toBe(false)
  })

  describe('a file above the member’s membership floor', () => {
    const FLOORED = { container_id: 'cohort-mine', content_ref: 'r-floored', content_type: 'resource', min_membership: 2 }
    beforeEach(() => {
      tables.community_resources.push({ id: 'r-floored', space_id: null, event_ref: null })
      tables.container_contents.push(FLOORED)
    })

    it('is not seen in a cohort, with or without the container named', async () => {
      expect(await memberCanSeeResource(member(), 'r-floored')).toBe(false)
      expect(await memberCanSeeResource(member(), 'r-floored', 'cohort-mine')).toBe(false)
    })

    it('is seen by a member who clears the floor', async () => {
      expect(await memberCanSeeResource(member({ hasPaidTier: true }), 'r-floored', 'cohort-mine')).toBe(true)
    })

    it('is seen in a Space, whose file list has no floor', async () => {
      tables.mentoring_cohorts = [{ id: 'space-box', name: 'Open', container_type: 'space', campaign_ref: 'open', lifecycle: 'active' }]
      tables.container_contents.push({ ...FLOORED, container_id: 'space-box' })
      expect(await memberCanSeeResource(member(), 'r-floored', 'space-box')).toBe(true)
      expect(await memberCanSeeResource(member(), 'r-floored', 'cohort-mine')).toBe(false)
    })
  })

  it('a file in a space’s container reaches a member who can enter the space', async () => {
    tables.mentoring_cohorts = [{ id: 'space-box', name: 'Open', container_type: 'space', campaign_ref: 'open', lifecycle: 'active' }]
    tables.container_contents.push({ container_id: 'space-box', content_ref: 'r-other-cohort', content_type: 'resource' })
    expect(await memberCanSeeResource(member(), 'r-other-cohort', 'space-box')).toBe(true)
  })

  it('an admin sees any that exists', async () => {
    expect(await memberCanSeeResource(admin, 'r-other-cohort', 'cohort-other')).toBe(true)
    expect(await memberCanSeeResource(admin, 'r-other-cohort')).toBe(true)
    expect(await memberCanSeeResource(admin, 'r-event')).toBe(true)
    expect(await memberCanSeeResource(admin, 'missing')).toBe(false)
  })

  it('the container an admin names must hold the file too', async () => {
    expect(await memberCanSeeResource(admin, 'r-other-cohort', 'cohort-mine')).toBe(false)
    expect(await memberCanSeeResource(admin, 'r-standalone', 'cohort-mine')).toBe(false)
  })
})
