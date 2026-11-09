import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// S5 B9: another tenant's event gets no Space and leaves Stellr's Spaces alone.
// Everything else this function does for a Stellr event stays as it was.

const reconcile = vi.hoisted(() => vi.fn(async () => undefined))
const ensureContainer = vi.hoisted(() => vi.fn(async () => 'container-1'))

vi.mock('@/lib/space-inheritance', () => ({ reconcileEventSpaceRoster: reconcile }))
vi.mock('@/lib/container-sync', () => ({ ensureEventContainer: ensureContainer }))

import { eventSpaceSyncFailed, otherTenantEventIds, syncEventSpace } from '@/lib/event-space-sync'

const EV = { sanityId: 'sanity-1', slug: 'shared-slug', title: 'An event' }
const OTHER_TENANT = '11111111-1111-4111-8111-111111111111'

/** What the mirror holds for EV. The read returns only the columns and rows asked for, as PostgREST does. */
type Mirror = { tenant_id: string } | null

interface Options {
  mirror?: Mirror
  mirrorError?: { message: string }
  /** No Space on the event's slug, so the sync inserts one. */
  noSpace?: boolean
  /** What writing to community_spaces answers. */
  spaceWriteError?: { code: string; message: string }
}

const GRANT_AND_ROSTER_WRITES = [
  'upsert community_space_sources',
  'delete community_space_tiers',
  'delete community_space_roles',
  'insert community_channels',
]

/**
 * A database with one unadopted Stellr Space on the event's slug, holding a tier grant.
 * Records every write, by table.
 */
function fakeDb(options: Options) {
  const writes: string[] = []
  const mirrorRead = (column: string | undefined, filters: Array<[string, unknown]>) => {
    if (options.mirrorError) return { data: null, error: options.mirrorError }
    const row = { sanity_id: EV.sanityId, slug: EV.slug, tenant_id: options.mirror?.tenant_id }
    const matches = options.mirror && filters.every(([col, value]) => row[col as keyof typeof row] === value)
    if (!matches || !column) return { data: null, error: null }
    return { data: { [column]: row[column as keyof typeof row] }, error: null }
  }
  const from = (table: string) => {
    let op = 'read'
    let selected: string | undefined
    const filters: Array<[string, unknown]> = []
    const builder: Record<string, unknown> = {}
    const chain = () => builder
    for (const name of ['is', 'limit', 'in', 'neq']) builder[name] = chain
    builder.select = (columns: string) => {
      selected = columns
      return builder
    }
    builder.eq = (column: string, value: unknown) => {
      filters.push([column, value])
      if (column === 'slug') op = 'bySlug'
      return builder
    }
    for (const name of ['insert', 'update', 'upsert', 'delete']) {
      builder[name] = () => {
        writes.push(`${name} ${table}`)
        op = 'write'
        return builder
      }
    }
    builder.maybeSingle = async () => {
      if (table === 'events') return mirrorRead(selected, filters)
      if (table === 'community_spaces' && op === 'bySlug' && !options.noSpace) {
        return { data: { id: 'space-1', slug: EV.slug, name: 'Our Space', sanity_event_id: null }, error: null }
      }
      if (table === 'community_spaces' && op === 'write') {
        if (options.spaceWriteError) return { data: null, error: options.spaceWriteError }
        return { data: { id: 'space-new' }, error: null }
      }
      return { data: null, error: null }
    }
    builder.then = (resolve: (value: unknown) => unknown) => {
      const error = table === 'community_spaces' && op === 'write' ? options.spaceWriteError ?? null : null
      return resolve({ data: [], error })
    }
    return builder
  }
  return { db: { from, rpc: async () => ({ error: null }) } as unknown as SupabaseClient, writes }
}

beforeEach(() => {
  reconcile.mockClear()
  ensureContainer.mockClear()
})

describe('syncEventSpace', () => {
  it('writes nothing for another tenant\'s event, even with a Stellr Space on its slug', async () => {
    const { db, writes } = fakeDb({ mirror: { tenant_id: OTHER_TENANT } })
    const result = await syncEventSpace(db, EV)

    expect(writes).toEqual([])
    expect(ensureContainer).not.toHaveBeenCalled()
    expect(reconcile).not.toHaveBeenCalled()
    expect(result.skippedOtherTenant).toBe(true)
    expect(result.spaceId).toBeNull()
    expect(result.containerId).toBeNull()
    expect(result.created).toBe(false)
    expect(result.grantsCleared).toBe(0)
    expect(result.notes).toEqual(['skipped: the event belongs to another tenant, and community is Stellr-only'])
  })

  it.each<[string, Mirror]>([
    ['a Stellr event', { tenant_id: STELLR_TENANT_ID }],
    ['an event the mirror has no row for yet', null],
  ])('runs in full for %s', async (_label, mirror) => {
    const { db, writes } = fakeDb({ mirror })
    const result = await syncEventSpace(db, EV)

    expect(ensureContainer).toHaveBeenCalledWith(db, EV.slug, EV.title)
    expect(reconcile).toHaveBeenCalledWith(db, EV.slug)
    expect(result.skippedOtherTenant).toBe(false)
    expect(result.spaceId).toBe('space-1')
    expect(result.containerId).toBe('container-1')
    expect(writes).toEqual(expect.arrayContaining(['update community_spaces', ...GRANT_AND_ROSTER_WRITES]))
  })

  it('throws when the mirror read fails, before any write', async () => {
    const { db, writes } = fakeDb({ mirrorError: { message: 'boom' } })

    await expect(syncEventSpace(db, EV)).rejects.toThrow(/events lookup failed/)
    expect(writes).toEqual([])
    expect(ensureContainer).not.toHaveBeenCalled()
    expect(reconcile).not.toHaveBeenCalled()
  })

  describe('when the check refuses the Space', () => {
    const refused = { code: '23514', message: 'violates check constraint "community_spaces_stellr_only"' }

    it('keeps the grants, adds no link and copies no roster when adopting a Space', async () => {
      const { db, writes } = fakeDb({ mirror: null, spaceWriteError: refused })
      const result = await syncEventSpace(db, EV)

      expect(writes).toContain('update community_spaces')
      for (const write of GRANT_AND_ROSTER_WRITES) expect(writes).not.toContain(write)
      expect(reconcile).not.toHaveBeenCalled()
      expect(result).toMatchObject({ skippedOtherTenant: true, spaceId: null, containerId: null, grantsCleared: 0 })
    })

    it('stops the same way when creating a Space', async () => {
      const { db, writes } = fakeDb({ mirror: null, noSpace: true, spaceWriteError: refused })
      const result = await syncEventSpace(db, EV)

      expect(writes).toContain('insert community_spaces')
      for (const write of GRANT_AND_ROSTER_WRITES) expect(writes).not.toContain(write)
      expect(reconcile).not.toHaveBeenCalled()
      expect(result).toMatchObject({ skippedOtherTenant: true, spaceId: null, containerId: null })
    })
  })

  it('still carries on after any other failed Space update, as it always has', async () => {
    const { db, writes } = fakeDb({ mirror: { tenant_id: STELLR_TENANT_ID }, spaceWriteError: { code: '23505', message: 'taken' } })
    const result = await syncEventSpace(db, EV)

    expect(result.notes).toContain('space update failed: taken')
    expect(result.skippedOtherTenant).toBe(false)
    expect(writes).toEqual(expect.arrayContaining(GRANT_AND_ROSTER_WRITES))
    expect(reconcile).toHaveBeenCalledWith(db, EV.slug)
  })
})

describe('eventSpaceSyncFailed', () => {
  const base = { containerId: null, created: false, renamedFrom: null, slugCollision: false, grantsCleared: 0, notes: [] }

  it('is a failure only when an event that should have a Space has none', () => {
    expect(eventSpaceSyncFailed({ ...base, spaceId: null, skippedOtherTenant: false })).toBe(true)
    expect(eventSpaceSyncFailed({ ...base, spaceId: null, skippedOtherTenant: true })).toBe(false)
    expect(eventSpaceSyncFailed({ ...base, spaceId: 'space-1', skippedOtherTenant: false })).toBe(false)
  })
})

describe('otherTenantEventIds', () => {
  function dbAnswering(answer: { data: unknown; error: { message: string } | null }) {
    const calls: unknown[][] = []
    const builder = {
      select: (...args: unknown[]) => {
        calls.push(['select', ...args])
        return builder
      },
      neq: (...args: unknown[]) => {
        calls.push(['neq', ...args])
        return Promise.resolve(answer)
      },
    }
    const db = {
      from: (table: string) => {
        calls.push(['from', table])
        return builder
      },
    } as unknown as SupabaseClient
    return { db, calls }
  }

  it('asks for the events that are not Stellr\'s', async () => {
    const { db, calls } = dbAnswering({ data: [{ sanity_id: 'a' }, { sanity_id: 'b' }], error: null })

    expect(await otherTenantEventIds(db)).toEqual(new Set(['a', 'b']))
    expect(calls).toEqual([['from', 'events'], ['select', 'sanity_id'], ['neq', 'tenant_id', STELLR_TENANT_ID]])
  })

  it('throws rather than reporting nothing when the read fails', async () => {
    const { db } = dbAnswering({ data: null, error: { message: 'boom' } })

    await expect(otherTenantEventIds(db)).rejects.toThrow(/events lookup failed/)
  })
})
