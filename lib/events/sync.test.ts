// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import {
  eventCountry,
  syncEventFromSanity,
  syncEventMirrorSafe,
  toEventRow,
  upsertEventRows,
  type SanityEventDoc,
} from './sync'

const NOW = new Date('2026-11-04T12:00:00Z')

const nevada: SanityEventDoc = {
  _id: 'evt-nevada',
  _updatedAt: '2026-11-01T10:00:00Z',
  title: 'Nevada Space Design Challenge',
  slug: 'nevada-space-design-challenge',
  activityType: 'live_event',
  date: '2026-11-06',
  endDate: '2026-11-07',
  state: 'NV',
}

/** A minimal stand-in for the supabase-js upsert chain. */
function fakeDb(result: { error: { message: string } | null } = { error: null }) {
  const upsert = vi.fn(async (_rows: unknown, _opts: unknown) => result)
  const from = vi.fn((_table: string) => ({ upsert }))
  return { db: { from } as unknown as SupabaseClient, from, upsert }
}

describe('toEventRow', () => {
  it('maps a US live event: Stellr, USD, US grades, zone from the state, exclusive end', () => {
    const row = toEventRow(nevada, undefined, NOW)!
    expect(row).toMatchObject({
      tenant_id: STELLR_TENANT_ID,
      slug: 'nevada-space-design-challenge',
      sanity_id: 'evt-nevada',
      title: 'Nevada Space Design Challenge',
      activity_type: 'live_event',
      time_zone: 'America/Los_Angeles',
      country: 'US',
      currency: 'usd',
      grade_system: 'us_grades',
      min_participant_age: null,
      source_updated_at: '2026-11-01T10:00:00Z',
      synced_at: NOW.toISOString(),
    })
    // Local midnight 6 Nov in Las Vegas (PST, UTC-8) and midnight after 7 Nov.
    expect(row.starts_at).toBe('2026-11-06T08:00:00.000Z')
    expect(row.ends_at).toBe('2026-11-08T08:00:00.000Z')
    expect(row.raw).toMatchObject({ _id: 'evt-nevada', slug: 'nevada-space-design-challenge', state: 'NV' })
  })

  it('accepts the unflattened { current } slug shape', () => {
    expect(toEventRow({ ...nevada, slug: { current: 'x-y' } })!.slug).toBe('x-y')
  })

  it('maps an Australian event to AUD and Year levels', () => {
    const row = toEventRow({ ...nevada, country: 'au', state: null })!
    expect(row).toMatchObject({ country: 'AU', currency: 'aud', grade_system: 'au_years' })
  })

  it('keeps a non-US, non-AU venue country but the tenant currency', () => {
    expect(toEventRow({ ...nevada, country: 'UY' })!).toMatchObject({ country: 'UY', currency: 'usd', grade_system: 'us_grades' })
  })

  it('leaves campaigns and undated events without dates', () => {
    const row = toEventRow({ ...nevada, activityType: 'campaign', date: null, endDate: null })!
    expect(row).toMatchObject({ activity_type: 'campaign', starts_at: null, ends_at: null })
  })

  it('never produces an end before the start (an end date earlier than the date is ignored)', () => {
    const row = toEventRow({ ...nevada, endDate: '2026-11-01' })!
    expect(new Date(row.ends_at!).getTime()).toBeGreaterThan(new Date(row.starts_at!).getTime())
  })

  it('refuses drafts, documents without an _id and documents without a slug', () => {
    expect(toEventRow({ ...nevada, _id: 'drafts.evt-nevada' })).toBeNull()
    expect(toEventRow({ ...nevada, _id: '' })).toBeNull()
    expect(toEventRow({ ...nevada, slug: null })).toBeNull()
  })

  it('falls back to the slug for a missing title', () => {
    expect(toEventRow({ ...nevada, title: '  ' })!.title).toBe('nevada-space-design-challenge')
  })
})

describe('eventCountry', () => {
  it('treats blank and USA as the US, and junk as the US', () => {
    expect(eventCountry(undefined)).toBe('US')
    expect(eventCountry(' usa ')).toBe('US')
    expect(eventCountry('Uruguay')).toBe('US')
    expect(eventCountry('uy')).toBe('UY')
  })
})

describe('upsertEventRows / syncEventFromSanity', () => {
  it('upserts on the Sanity _id so a renamed slug updates in place', async () => {
    const { db, from, upsert } = fakeDb()
    const row = toEventRow(nevada, undefined, NOW)!
    expect(await upsertEventRows(db, [row])).toEqual({ error: null })
    expect(from).toHaveBeenCalledWith('events')
    expect(upsert).toHaveBeenCalledWith([row], { onConflict: 'sanity_id' })
  })

  it('writes nothing for an empty batch', async () => {
    const { db, from } = fakeDb()
    expect(await upsertEventRows(db, [])).toEqual({ error: null })
    expect(from).not.toHaveBeenCalled()
  })

  it('syncs an event fetched by _id', async () => {
    const { db, upsert } = fakeDb()
    const fetcher = vi.fn(async () => nevada)
    const r = await syncEventFromSanity(db, { sanityId: 'evt-nevada' }, { fetcher })
    expect(fetcher).toHaveBeenCalledWith({ sanityId: 'evt-nevada' })
    expect(r).toEqual({ status: 'synced', slug: 'nevada-space-design-challenge', sanityId: 'evt-nevada' })
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('reports missing (and writes nothing) when Sanity has no such event', async () => {
    const { db, upsert } = fakeDb()
    expect(await syncEventFromSanity(db, { slug: 'gone' }, { fetcher: async () => null })).toEqual({ status: 'missing' })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('skips a call with neither _id nor slug', async () => {
    const { db } = fakeDb()
    expect((await syncEventFromSanity(db, {}, { fetcher: async () => nevada })).status).toBe('skipped')
  })

  it('returns the database error rather than throwing', async () => {
    const { db } = fakeDb({ error: { message: 'duplicate key value violates unique constraint "events_slug_key"' } })
    const r = await syncEventFromSanity(db, { sanityId: 'evt-nevada' }, { fetcher: async () => nevada })
    expect(r).toEqual({ status: 'error', error: expect.stringMatching(/events_slug_key/) })
  })
})

describe('syncEventMirrorSafe — never throws, never hangs the webhook', () => {
  it('passes a success through without reporting', async () => {
    const { db } = fakeDb()
    const report = vi.fn(async () => {})
    const r = await syncEventMirrorSafe(db, { sanityId: 'evt-nevada' }, { fetcher: async () => nevada, report })
    expect(r.status).toBe('synced')
    expect(report).not.toHaveBeenCalled()
  })

  it('reports a database error to app_errors and returns it', async () => {
    const { db } = fakeDb({ error: { message: 'boom' } })
    const report = vi.fn(async () => {})
    const r = await syncEventMirrorSafe(db, { sanityId: 'evt-nevada' }, { fetcher: async () => nevada, report })
    expect(r.status).toBe('error')
    expect(report).toHaveBeenCalledWith(expect.any(Error), '/api/admin/sanity/event-sync')
  })

  it('swallows a thrown fetch error', async () => {
    const { db } = fakeDb()
    const report = vi.fn(async () => {})
    const r = await syncEventMirrorSafe(db, { sanityId: 'x' }, {
      fetcher: async () => { throw new Error('Sanity down') },
      report,
    })
    expect(r).toEqual({ status: 'error', error: 'Sanity down' })
    expect(report).toHaveBeenCalledTimes(1)
  })

  it('survives a reporter that itself throws', async () => {
    const { db } = fakeDb()
    const r = await syncEventMirrorSafe(db, { sanityId: 'x' }, {
      fetcher: async () => { throw new Error('Sanity down') },
      report: async () => { throw new Error('app_errors down') },
    })
    expect(r.status).toBe('error')
  })

  it('gives up after the timeout', async () => {
    const { db } = fakeDb()
    const report = vi.fn(async () => {})
    const r = await syncEventMirrorSafe(db, { sanityId: 'x' }, {
      fetcher: () => new Promise(() => {}),
      timeoutMs: 20,
      report,
    })
    expect(r).toEqual({ status: 'timeout' })
    expect(report).toHaveBeenCalledTimes(1)
  })
})
