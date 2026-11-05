// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// The mirror must never sit on the caller's path, and must never decide on its own
// that an event it has not seen belongs to Stellr.
const sanity = vi.hoisted(() => ({
  bySlug: vi.fn(async (slug: string) => ({ _id: 'evt-1', slug: { current: slug }, title: 'Event One' }) as unknown),
}))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: sanity.bySlug }))
const after = vi.hoisted(() => ({ tasks: [] as (() => Promise<unknown>)[] }))
vi.mock('@/lib/after-response', () => ({
  runAfterResponse: (_label: string, task: () => Promise<unknown>) => { after.tasks.push(task) },
}))
const sync = vi.hoisted(() => ({ fn: vi.fn(async (_db: unknown, _by: unknown, _o: unknown) => ({ status: 'synced' as string })) }))
vi.mock('./sync', () => ({ syncEventFromSanity: sync.fn }))

const { ensureEventMirrored, getEventBySlugMirrored, getMirroredEvent } = await import('./mirror')

const TENANT = { tenantId: '11111111-1111-4111-8111-111111111111', currency: 'aud' as const }

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

describe('getEventBySlugMirrored', () => {
  it('returns at once and only schedules the mirror check for after the response', async () => {
    const { db, from } = fakeDb([])
    const ev = await getEventBySlugMirrored('nevada', { db, tenant: TENANT })
    expect(ev).toMatchObject({ _id: 'evt-1' })
    expect(after.tasks).toHaveLength(1)
    expect(from).not.toHaveBeenCalled() // nothing ran on the caller's path
    expect(sync.fn).not.toHaveBeenCalled()
  })

  it('writes a miss for the tenant it was given', async () => {
    const { db } = fakeDb([])
    await getEventBySlugMirrored('nevada', { db, tenant: TENANT })
    await after.tasks[0]()
    expect(sync.fn).toHaveBeenCalledWith(db, { slug: 'nevada' }, { fetcher: undefined, tenant: TENANT })
  })

  it('schedules no mirror work when Sanity has no such event', async () => {
    sanity.bySlug.mockResolvedValueOnce(null)
    expect(await getEventBySlugMirrored('missing', { db: fakeDb([]).db, tenant: TENANT })).toBeNull()
    expect(after.tasks).toHaveLength(0)
  })
})

describe('getMirroredEvent', () => {
  const row = { id: 'u1', slug: 'nevada', tenant_id: TENANT.tenantId }

  it('returns a mirror hit without syncing', async () => {
    expect(await getMirroredEvent('nevada', { db: fakeDb([row]).db, syncOnMissFor: TENANT })).toEqual(row)
    expect(sync.fn).not.toHaveBeenCalled()
  })

  it('a miss with no tenant named stays a miss: nothing is written under a default owner', async () => {
    expect(await getMirroredEvent('nevada', { db: fakeDb([]).db })).toBeNull()
    expect(sync.fn).not.toHaveBeenCalled()
  })

  it('an untyped caller asking for the old boolean sync still writes nothing', async () => {
    const opts = { db: fakeDb([]).db, syncOnMiss: true } as unknown as Parameters<typeof getMirroredEvent>[1]
    expect(await getMirroredEvent('nevada', opts)).toBeNull()
    expect(sync.fn).not.toHaveBeenCalled()
  })

  it('syncs on a miss for the named tenant, then re-reads', async () => {
    const rows: Record<string, unknown>[] = []
    const { db, eq } = fakeDb(rows)
    sync.fn.mockImplementationOnce(async () => {
      rows.push(row)
      return { status: 'synced' }
    })
    expect(await getMirroredEvent('nevada', { db, syncOnMissFor: TENANT })).toEqual(row)
    expect(sync.fn).toHaveBeenCalledWith(db, { slug: 'nevada' }, { fetcher: undefined, tenant: TENANT })
    expect(eq).toHaveBeenCalledTimes(2)
  })

  it('returns null when the sync on a miss finds nothing', async () => {
    sync.fn.mockResolvedValueOnce({ status: 'missing' })
    expect(await getMirroredEvent('nevada', { db: fakeDb([]).db, syncOnMissFor: TENANT })).toBeNull()
  })

  it('throws a read error to admin callers rather than answering for an owner', async () => {
    const { db } = fakeDb([], { message: 'relation "events" does not exist' })
    await expect(getMirroredEvent('nevada', { db })).rejects.toThrow(/events mirror read failed/)
  })
})

describe('ensureEventMirrored', () => {
  it('defers the work, and the deferred task syncs a miss', async () => {
    const { db } = fakeDb([])
    ensureEventMirrored('nevada', { db, tenant: TENANT })
    expect(sync.fn).not.toHaveBeenCalled()
    expect(after.tasks).toHaveLength(1)
    await after.tasks[0]()
    expect(sync.fn).toHaveBeenCalledTimes(1)
  })

  it('ignores an empty slug', () => {
    ensureEventMirrored('', { db: fakeDb([]).db, tenant: TENANT })
    expect(after.tasks).toHaveLength(0)
  })
})
