// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// The facade must return exactly what lib/sanity returns (no behaviour change
// in S3), and the mirror must never sit on the caller's path.
const sanity = vi.hoisted(() => ({
  bySlug: vi.fn(async (slug: string) => ({ _id: 'evt-1', slug: { current: slug }, title: 'Event One' }) as unknown),
  all: vi.fn(async () => [{ _id: 'evt-1' }]),
  bySlugs: vi.fn(async (_s: string[]) => [{ _id: 'evt-1' }]),
  byIds: vi.fn(async (_i: string[]) => [{ _id: 'evt-1' }]),
}))
vi.mock('@/lib/sanity', () => ({
  getEventBySlug: sanity.bySlug,
  getAllEvents: sanity.all,
  getEventsBySlugs: sanity.bySlugs,
  getEventsByIds: sanity.byIds,
}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => { throw new Error('no default client in tests') } }))
const after = vi.hoisted(() => ({ tasks: [] as (() => Promise<unknown>)[] }))
vi.mock('@/lib/after-response', () => ({
  runAfterResponse: (_label: string, task: () => Promise<unknown>) => { after.tasks.push(task) },
}))
const sync = vi.hoisted(() => ({ fn: vi.fn(async (_db: unknown, _by: unknown, _o: unknown) => ({ status: 'synced' as string })) }))
vi.mock('./sync', () => ({ syncEventFromSanity: sync.fn }))

const { getEventBySlug, getAllEvents, getEventsBySlugs, getEventsByIds, getMirroredEvent, getEventTenantId, ensureEventMirrored } =
  await import('./repo')
const { STELLR_TENANT_ID } = await import('@/lib/tenancy/constants')

/** A fake supabase-js client whose events table answers from `rows`. */
function fakeDb(rows: Record<string, unknown>[], error: { message: string } | null = null) {
  const eq = vi.fn((_col: string, val: string) => ({
    maybeSingle: async () => ({ data: rows.find((r) => r.slug === val) ?? null, error }),
  }))
  const select = vi.fn((_cols: string) => ({ eq }))
  const from = vi.fn((_t: string) => ({ select }))
  return { db: { from } as unknown as SupabaseClient, from, eq }
}

beforeEach(() => {
  after.tasks.length = 0
  sync.fn.mockClear()
  sanity.bySlug.mockClear()
})

describe('events facade — Sanity reads are unchanged', () => {
  it('getEventBySlug returns lib/sanity\'s result and schedules nothing by default', async () => {
    const ev = await getEventBySlug('nevada')
    expect(sanity.bySlug).toHaveBeenCalledWith('nevada')
    expect(ev).toEqual({ _id: 'evt-1', slug: { current: 'nevada' }, title: 'Event One' })
    expect(after.tasks).toHaveLength(0)
  })

  it('passes the list reads straight through', async () => {
    expect(await getAllEvents()).toEqual([{ _id: 'evt-1' }])
    expect(await getEventsBySlugs(['a'])).toEqual([{ _id: 'evt-1' }])
    expect(sanity.bySlugs).toHaveBeenCalledWith(['a'])
    expect(await getEventsByIds(['evt-1'])).toEqual([{ _id: 'evt-1' }])
    expect(sanity.byIds).toHaveBeenCalledWith(['evt-1'])
  })

  it('with { mirror: true } returns at once and only schedules the mirror check for after the response', async () => {
    const ev = await getEventBySlug('nevada', { mirror: true })
    expect(ev).toMatchObject({ _id: 'evt-1' })
    expect(after.tasks).toHaveLength(1)
    expect(sync.fn).not.toHaveBeenCalled() // nothing ran on the caller's path
  })

  it('schedules no mirror work when Sanity has no such event', async () => {
    sanity.bySlug.mockResolvedValueOnce(null)
    expect(await getEventBySlug('missing', { mirror: true })).toBeNull()
    expect(after.tasks).toHaveLength(0)
  })
})

describe('events mirror reads', () => {
  const row = { id: 'u1', slug: 'nevada', tenant_id: '11111111-1111-4111-8111-111111111111' }

  it('returns a mirror hit without syncing', async () => {
    const { db } = fakeDb([row])
    expect(await getMirroredEvent('nevada', { db, syncOnMiss: true })).toEqual(row)
    expect(sync.fn).not.toHaveBeenCalled()
  })

  it('returns null on a miss unless asked to sync', async () => {
    const { db } = fakeDb([])
    expect(await getMirroredEvent('nevada', { db })).toBeNull()
    expect(sync.fn).not.toHaveBeenCalled()
  })

  it('syncs on a miss when asked, then re-reads', async () => {
    const rows: Record<string, unknown>[] = []
    const { db, eq } = fakeDb(rows)
    sync.fn.mockImplementationOnce(async () => {
      rows.push(row)
      return { status: 'synced' }
    })
    expect(await getMirroredEvent('nevada', { db, syncOnMiss: true })).toEqual(row)
    expect(sync.fn).toHaveBeenCalledWith(db, { slug: 'nevada' }, { fetcher: undefined })
    expect(eq).toHaveBeenCalledTimes(2)
  })

  it('returns null when the sync on a miss finds nothing', async () => {
    const { db } = fakeDb([])
    sync.fn.mockResolvedValueOnce({ status: 'missing' })
    expect(await getMirroredEvent('nevada', { db, syncOnMiss: true })).toBeNull()
  })

  it('throws a read error to admin callers', async () => {
    const { db } = fakeDb([], { message: 'relation "events" does not exist' })
    await expect(getMirroredEvent('nevada', { db })).rejects.toThrow(/events mirror read failed/)
  })

  it('getEventTenantId reads the mirror and falls back to Stellr on a miss or an error', async () => {
    expect(await getEventTenantId('nevada', { db: fakeDb([row]).db })).toBe(row.tenant_id)
    expect(await getEventTenantId('nevada', { db: fakeDb([]).db })).toBe(STELLR_TENANT_ID)
    expect(await getEventTenantId('nevada', { db: fakeDb([], { message: 'down' }).db })).toBe(STELLR_TENANT_ID)
  })

  it('ensureEventMirrored defers the work, and the deferred task syncs a miss', async () => {
    const { db } = fakeDb([])
    ensureEventMirrored('nevada', { db })
    expect(sync.fn).not.toHaveBeenCalled()
    expect(after.tasks).toHaveLength(1)
    await after.tasks[0]()
    expect(sync.fn).toHaveBeenCalledTimes(1)
  })

  it('ensureEventMirrored ignores an empty slug', () => {
    ensureEventMirrored('')
    expect(after.tasks).toHaveLength(0)
  })
})
