// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { notifyCommunityAdmins, enqueueVideoWatermark } = vi.hoisted(() => ({
  notifyCommunityAdmins: vi.fn(),
  enqueueVideoWatermark: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => { throw new Error('pass a db') } }))
vi.mock('@/lib/community', () => ({ RESOURCES_BUCKET: 'resources' }))
vi.mock('@/lib/notify', () => ({ notifyCommunityAdmins }))
vi.mock('@/lib/watermark/video-queue', () => ({ enqueueVideoWatermark }))

import { acceptUpload, failureMessage, markPhase, runOffload, targetForRoom } from './recording-offload'
import type { SupabaseClient } from '@supabase/supabase-js'

const target = { kind: 'training' as const, id: 'item-1' }

// Records every write, and answers the claim with whatever the test sets.
function fakeDb(opts: { claim?: { source_url: string; attempts: number } | null; existingKey?: string; path?: string | null; upload?: () => Promise<{ error: unknown }> } = {}) {
  const writes: { table: string; op: string; values: Record<string, unknown> }[] = []
  const uploads: { path: string; body: unknown; options: Record<string, unknown> }[] = []
  const db = {
    from(table: string) {
      let op = 'select'
      let values: Record<string, unknown> = {}
      const chain: Record<string, unknown> = {
        update(v: Record<string, unknown>) { op = 'update'; values = v; writes.push({ table, op, values }); return chain },
        upsert(v: Record<string, unknown>) { op = 'upsert'; values = v; writes.push({ table, op, values }); return chain },
        select() { return chain },
        eq() { return chain },
        not() { return chain },
        or() { return chain },
        maybeSingle: async () => {
          if (table === 'recording_offloads' && op === 'update') return { data: opts.claim === undefined ? { source_url: 'https://jaas/x', attempts: 0 } : opts.claim, error: null }
          if (table === 'recording_offloads') return { data: { idempotency_key: opts.existingKey ?? null }, error: null }
          return { data: { recording_path: opts.path ?? null, title: 'Why They Matter' }, error: null }
        },
        then(resolve: (v: { error: null }) => void) { resolve({ error: null }) },
      }
      return chain
    },
    storage: {
      from: () => ({
        upload: async (path: string, body: unknown, options: Record<string, unknown>) => {
          uploads.push({ path, body, options })
          return opts.upload ? opts.upload() : { error: null }
        },
      }),
    },
  }
  return { db: db as unknown as SupabaseClient, writes, uploads }
}

const body = () => new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); c.close() } })
const stubFetch = (res: () => Response) => vi.stubGlobal('fetch', vi.fn(async () => res()))
const lastStatus = (writes: { table: string; values: Record<string, unknown> }[], table: string) =>
  writes.filter((w) => w.table === table && 'status' in w.values).at(-1)?.values

beforeEach(() => {
  notifyCommunityAdmins.mockReset()
  enqueueVideoWatermark.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('targetForRoom', () => {
  it('maps training and session rooms', () => {
    expect(targetForRoom('stellr-train-abc')).toEqual({ kind: 'training', id: 'abc' })
    expect(targetForRoom('stellr-abc')).toEqual({ kind: 'session', id: 'abc' })
    expect(targetForRoom('other')).toBeNull()
  })
})

describe('failureMessage', () => {
  it('names the size when storage refuses the file, never the raw error', () => {
    const m = failureMessage({ statusCode: '413', code: 'EntityTooLarge', message: 'The object exceeded' }, 212 * 1024 * 1024)
    expect(m).toContain('212 MB')
    expect(m).not.toContain('exceeded')
  })
})

describe('acceptUpload', () => {
  it('saves the link and when it dies, before any copy starts', async () => {
    const { db, writes } = fakeDb()
    expect(await acceptUpload(target, 'https://jaas/x', 'key-1', db)).toBe(true)
    const row = writes[0].values
    expect(row.source_url).toBe('https://jaas/x')
    expect(row.idempotency_key).toBe('key-1')
    const hours = (Date.parse(row.source_expires_at as string) - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(23.9)
    expect(hours).toBeLessThanOrEqual(24)
  })

  it('ignores a redelivered event', async () => {
    const { db, writes } = fakeDb({ existingKey: 'key-1' })
    expect(await acceptUpload(target, 'https://jaas/x', 'key-1', db)).toBe(false)
    expect(writes).toEqual([])
  })
})

describe('markPhase', () => {
  it('starting a recording clears the last attempt', async () => {
    const { db, writes } = fakeDb()
    await markPhase(target, 'recording', db)
    expect(writes[0].values).toMatchObject({ status: 'recording', source_url: null, error: null })
  })
})

describe('runOffload', () => {
  it('streams the file rather than buffering it, then records it as saved', async () => {
    const stream = body()
    stubFetch(() => new Response(stream, { headers: { 'content-length': '1000' } }))
    const { db, writes, uploads } = fakeDb()

    expect(await runOffload(target, db)).toBe(true)

    expect(uploads[0].body).toBe(stream)
    expect(uploads[0].options).toMatchObject({ upsert: true, duplex: 'half', contentType: 'video/mp4' })
    expect(uploads[0].path).toBe('recordings/train-item-1.mp4')
    expect(lastStatus(writes, 'recording_offloads')).toMatchObject({ status: 'saved', source_url: null, size_bytes: 1000 })
    expect(writes.find((w) => w.table === 'training_items' && w.values.recording_status === 'available')).toBeTruthy()
    expect(enqueueVideoWatermark).toHaveBeenCalled()
    expect(notifyCommunityAdmins).not.toHaveBeenCalled()
  })

  it('does nothing when another run holds the job', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { db } = fakeDb({ claim: null })
    expect(await runOffload(target, db)).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('the storage limit: says why, keeps the link, tells admins, does not retry', async () => {
    stubFetch(() => new Response(body(), { headers: { 'content-length': String(120 * 1024 * 1024) } }))
    const upload = vi.fn(async () => ({ error: { statusCode: '413', code: 'EntityTooLarge', message: 'too big' } }))
    const { db, writes } = fakeDb({ upload })

    expect(await runOffload(target, db)).toBe(false)

    expect(upload).toHaveBeenCalledTimes(1)
    const row = lastStatus(writes, 'recording_offloads')
    expect(row).toMatchObject({ status: 'failed', size_bytes: 120 * 1024 * 1024 })
    expect(row?.error).toContain('120 MB')
    // The link has to survive a failure: it is what a retry runs from.
    expect(row).not.toHaveProperty('source_url')
    expect(notifyCommunityAdmins).toHaveBeenCalledTimes(1)
    expect(notifyCommunityAdmins.mock.calls[0][0].body).toContain('Why They Matter')
  })

  it('a failed replacement leaves the existing recording playable', async () => {
    stubFetch(() => new Response(body()))
    const { db, writes } = fakeDb({ path: 'recordings/old.mp4', upload: async () => ({ error: { statusCode: '413' } }) })
    await runOffload(target, db)
    const statuses = writes.filter((w) => w.table === 'training_items').map((w) => w.values.recording_status)
    expect(statuses).toEqual(['available'])
  })

  it('a first-time failure returns the lesson to none', async () => {
    stubFetch(() => new Response(body()))
    const { db, writes } = fakeDb({ upload: async () => ({ error: { statusCode: '413' } }) })
    await runOffload(target, db)
    const statuses = writes.filter((w) => w.table === 'training_items').map((w) => w.values.recording_status)
    expect(statuses).toEqual(['pending', 'none'])
  })

  it('tries once more after a transient failure', async () => {
    stubFetch(() => new Response(body()))
    let calls = 0
    const { db } = fakeDb({ upload: async () => (++calls === 1 ? { error: { message: 'network' } } : { error: null }) })
    expect(await runOffload(target, db)).toBe(true)
    expect(calls).toBe(2)
  })

  it('does not retry a link JaaS has already expired', async () => {
    const fetchSpy = vi.fn(async () => new Response('gone', { status: 403 }))
    vi.stubGlobal('fetch', fetchSpy)
    const { db, writes } = fakeDb()
    expect(await runOffload(target, db)).toBe(false)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(lastStatus(writes, 'recording_offloads')?.error).toMatch(/no longer has/)
  })
})
