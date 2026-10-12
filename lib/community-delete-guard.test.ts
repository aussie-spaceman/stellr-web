// @vitest-environment node
import { describe, it, expect } from 'vitest'

// deep review DB-4 (safeguarding / data-retention): a space/cohort hard delete
// cascades away chat messages, posts, comments and suspension records (no DB
// backups → irreversible). The guard must BLOCK the delete when any such record
// exists, ALLOW it only when provably empty, and FAIL CLOSED (block) on any
// lookup error. These tests pin all three, driving a fake Supabase client.

type QueryResult = { data?: unknown; count?: number | null; error?: { message: string } | null }

// Minimal awaitable query builder: select/eq/in all return the same chainable,
// which resolves to the per-table result. One query per table in the guard.
function makeDb(results: Record<string, QueryResult>) {
  const tablesHit: string[] = []
  const db = {
    tablesHit,
    from(table: string) {
      tablesHit.push(table)
      const result: QueryResult = results[table] ?? { data: [], count: 0, error: null }
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.in = () => chain
      chain.then = (resolve: (v: QueryResult) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject)
      return chain
    },
  }
  // The guard types its param as the real supabase client; this fake stands in.
  return db as unknown as Parameters<typeof assertSpaceDeletable>[0] & { tablesHit: string[] }
}

import { assertSpaceDeletable, assertCohortDeletable, CommunityDeleteBlockedError } from './community-delete-guard'

describe('assertSpaceDeletable — DB-4 preserve-before-delete', () => {
  it('blocks (CommunityDeleteBlockedError) when the space has posts', async () => {
    const db = makeDb({
      community_posts: { count: 3, error: null },
      chat_channels: { data: [], error: null },
      community_space_suspensions: { count: 0, error: null },
    })
    await expect(assertSpaceDeletable(db, 's1')).rejects.toBeInstanceOf(CommunityDeleteBlockedError)
  })

  it('blocks when the space has chat messages (via its space channels)', async () => {
    const db = makeDb({
      community_posts: { count: 0, error: null },
      chat_channels: { data: [{ id: 'c1' }], error: null },
      chat_messages: { count: 5, error: null },
      community_space_suspensions: { count: 0, error: null },
    })
    const err = await assertSpaceDeletable(db, 's1').catch((e) => e)
    expect(err).toBeInstanceOf(CommunityDeleteBlockedError)
    expect((err as CommunityDeleteBlockedError).blockers).toContainEqual(
      expect.objectContaining({ table: 'chat_messages', count: 5 }),
    )
  })

  it('blocks when only suspension (moderation) records exist', async () => {
    const db = makeDb({
      community_posts: { count: 0, error: null },
      chat_channels: { data: [], error: null },
      community_space_suspensions: { count: 2, error: null },
    })
    await expect(assertSpaceDeletable(db, 's1')).rejects.toBeInstanceOf(CommunityDeleteBlockedError)
  })

  it('allows deletion when the space is provably empty', async () => {
    const db = makeDb({
      community_posts: { count: 0, error: null },
      chat_channels: { data: [], error: null },
      community_space_suspensions: { count: 0, error: null },
    })
    await expect(assertSpaceDeletable(db, 's1')).resolves.toBeUndefined()
  })

  it('FAILS CLOSED: a count error blocks (plain Error, NOT the empty path)', async () => {
    const db = makeDb({
      community_posts: { count: null, error: { message: 'boom' } },
    })
    const err = await assertSpaceDeletable(db, 's1').catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    // Must not be swallowed as "empty" — the delete is refused on any lookup error.
    expect(err).not.toBeInstanceOf(CommunityDeleteBlockedError)
    expect((err as Error).message).toMatch(/count community_posts failed/)
  })
})

describe('assertCohortDeletable — DB-4 preserve-before-delete', () => {
  it('blocks when the cohort/workshop has chat messages', async () => {
    const db = makeDb({
      chat_channels: { data: [{ id: 'c1' }], error: null },
      chat_messages: { count: 2, error: null },
    })
    await expect(assertCohortDeletable(db, 'k1')).rejects.toBeInstanceOf(CommunityDeleteBlockedError)
  })

  it('allows deletion when the cohort has no channels (nothing to lose)', async () => {
    const db = makeDb({ chat_channels: { data: [], error: null } })
    await expect(assertCohortDeletable(db, 'k1')).resolves.toBeUndefined()
  })

  it('FAILS CLOSED: a channel-lookup error blocks the delete', async () => {
    const db = makeDb({ chat_channels: { data: null, error: { message: 'boom' } } })
    const err = await assertCohortDeletable(db, 'k1').catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(CommunityDeleteBlockedError)
    expect((err as Error).message).toMatch(/chat_channels lookup failed/)
  })
})
