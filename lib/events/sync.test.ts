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

/** A minimal stand-in for the supabase-js owner read and upsert chain. */
function fakeDb(
  result: { error: { message: string } | null } = { error: null },
  owners: { data?: Record<string, unknown>[]; error?: { message: string } | null } = {},
) {
  const upsert = vi.fn(async (_rows: unknown, _opts: unknown) => result)
  const inList = vi.fn(async (_col: string, _ids: string[]) => ({ data: owners.data ?? [], error: owners.error ?? null }))
  const select = vi.fn((_cols: string) => ({ in: inList }))
  const from = vi.fn((_table: string) => ({ upsert, select }))
  return { db: { from } as unknown as SupabaseClient, from, upsert, inList, select }
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

  describe('a sync never changes who owns an event', () => {
    const TENANT_B = '22222222-2222-4222-8222-222222222222'
    const row = () => toEventRow(nevada, undefined, NOW)!
    const written = (upsert: ReturnType<typeof fakeDb>['upsert']) => (upsert.mock.calls[0][0] as ReturnType<typeof row>[])[0]

    it('republishing a document leaves an existing row with its tenant and currency', async () => {
      const { db, upsert, inList } = fakeDb(undefined, { data: [{ sanity_id: 'evt-nevada', tenant_id: TENANT_B, currency: 'aud' }] })
      expect(await upsertEventRows(db, [row()])).toEqual({ error: null })
      expect(inList).toHaveBeenCalledWith('sanity_id', ['evt-nevada'])
      expect(written(upsert)).toEqual({ ...row(), tenant_id: TENANT_B, currency: 'aud', synced_at: NOW.toISOString() })
    })

    it('the webhook path keeps the owner too', async () => {
      const { db, upsert } = fakeDb(undefined, { data: [{ sanity_id: 'evt-nevada', tenant_id: TENANT_B, currency: 'usd' }] })
      await syncEventMirrorSafe(db, { sanityId: 'evt-nevada' }, { fetcher: async () => nevada, report: vi.fn() })
      expect(written(upsert).tenant_id).toBe(TENANT_B)
    })

    it('an Australian venue stays in AUD under its existing owner', async () => {
      const au = toEventRow({ ...nevada, country: 'AU', state: null }, undefined, NOW)!
      const { db, upsert } = fakeDb(undefined, { data: [{ sanity_id: 'evt-nevada', tenant_id: TENANT_B, currency: 'usd' }] })
      await upsertEventRows(db, [au])
      expect(written(upsert)).toMatchObject({ tenant_id: TENANT_B, currency: 'aud' })
    })

    it('a row already under the same tenant is written as mapped, so Stellr rows do not change', async () => {
      const { db, upsert } = fakeDb(undefined, { data: [{ sanity_id: 'evt-nevada', tenant_id: STELLR_TENANT_ID, currency: 'aud' }] })
      const r = row()
      await upsertEventRows(db, [r])
      expect(written(upsert)).toBe(r)
    })

    it('a new row takes the tenant it was given', async () => {
      const { db, upsert } = fakeDb()
      await syncEventFromSanity(db, { slug: 'x' }, { fetcher: async () => nevada, tenant: { tenantId: TENANT_B, currency: 'aud' } })
      expect(written(upsert)).toMatchObject({ tenant_id: TENANT_B, currency: 'aud' })
    })

    it('writes nothing when the owners cannot be read', async () => {
      const { db, upsert } = fakeDb(undefined, { error: { message: 'read failed' } })
      expect(await upsertEventRows(db, [row()])).toEqual({ error: 'read failed' })
      expect(upsert).not.toHaveBeenCalled()
    })
  })

  describe('a non-owner row keeps its minimum age and time zone (S5 K4)', () => {
    const TENANT_B = '33333333-3333-4333-8333-333333333333'
    const row = () => toEventRow(nevada, undefined, NOW)!
    const written = (upsert: ReturnType<typeof fakeDb>['upsert']) => (upsert.mock.calls[0][0] as ReturnType<typeof row>[])[0]
    /** An existing mirror row as the owner read returns it: Nevada, as last synced. */
    const existing = (over: Record<string, unknown> = {}) => ({
      sanity_id: 'evt-nevada',
      tenant_id: TENANT_B,
      currency: 'usd',
      min_participant_age: 16,
      time_zone: 'America/Los_Angeles',
      country: 'US',
      state: 'NV',
      source_updated_at: '2026-10-20T09:00:00Z',
      ...over,
    })

    it('reads the kept values in the one owner read of the batch', async () => {
      const { db, select, inList, upsert } = fakeDb(undefined, { data: [existing()] })
      await upsertEventRows(db, [row(), toEventRow({ ...nevada, _id: 'evt-2', slug: 'two' }, undefined, NOW)!])
      expect(select).toHaveBeenCalledTimes(1)
      expect(select.mock.calls[0][0]).toBe(
        'sanity_id, tenant_id, currency, min_participant_age, time_zone, country, state:raw->>state, source_updated_at',
      )
      expect(inList).toHaveBeenCalledTimes(1)
      expect(inList).toHaveBeenCalledWith('sanity_id', ['evt-nevada', 'evt-2'])
      expect(upsert).toHaveBeenCalledTimes(1)
    })

    it('a Stellr row is written byte-identical to the mapped row, whatever the row held before', async () => {
      const { db, upsert } = fakeDb(undefined, {
        data: [existing({ tenant_id: STELLR_TENANT_ID, min_participant_age: 16, time_zone: 'America/Denver', state: 'NV' })],
      })
      const r = row()
      await upsertEventRows(db, [r])
      expect(written(upsert)).toBe(r)
      expect(JSON.stringify(written(upsert))).toBe(JSON.stringify(toEventRow(nevada, undefined, NOW)))
      expect(written(upsert)).toMatchObject({ min_participant_age: null, time_zone: 'America/Los_Angeles' })
    })

    it('keeps its minimum age across a republish', async () => {
      const { db, upsert } = fakeDb(undefined, { data: [existing()] })
      await upsertEventRows(db, [row()])
      expect(written(upsert)).toEqual({ ...row(), tenant_id: TENANT_B, min_participant_age: 16 })
    })

    it('keeps a NULL minimum as NULL', async () => {
      const { db, upsert } = fakeDb(undefined, { data: [existing({ min_participant_age: null })] })
      await upsertEventRows(db, [row()])
      expect(written(upsert).min_participant_age).toBeNull()
    })

    it('keeps it when the sync names the same tenant (the sync on a miss)', async () => {
      const { db, upsert } = fakeDb(undefined, { data: [existing()] })
      await upsertEventRows(db, [toEventRow(nevada, { tenantId: TENANT_B, currency: 'usd' }, NOW)!])
      expect(written(upsert)).toMatchObject({ tenant_id: TENANT_B, min_participant_age: 16 })
    })

    it('keeps its own time zone while the state and country are unchanged, and dates the event in it', async () => {
      const { db, upsert } = fakeDb(undefined, { data: [existing({ time_zone: 'America/Denver' })] })
      await upsertEventRows(db, [row()])
      // Local midnight 6 Nov in Denver (MST, UTC-7) and midnight after 7 Nov.
      expect(written(upsert)).toEqual({
        ...row(),
        tenant_id: TENANT_B,
        min_participant_age: 16,
        time_zone: 'America/Denver',
        starts_at: '2026-11-06T07:00:00.000Z',
        ends_at: '2026-11-08T07:00:00.000Z',
      })
    })

    it('treats a state written out in full as the same state', async () => {
      const { db, upsert } = fakeDb(undefined, { data: [existing({ time_zone: 'America/Denver', state: ' Nevada ' })] })
      await upsertEventRows(db, [row()])
      expect(written(upsert).time_zone).toBe('America/Denver')
    })

    it('recomputes the time zone as today when the state changed', async () => {
      const { db, upsert } = fakeDb(undefined, { data: [existing({ time_zone: 'America/Denver', state: 'CO' })] })
      await upsertEventRows(db, [row()])
      expect(written(upsert)).toEqual({ ...row(), tenant_id: TENANT_B, min_participant_age: 16 })
      expect(written(upsert).time_zone).toBe('America/Los_Angeles')
    })

    it('recomputes the time zone as today when the country changed', async () => {
      const { db, upsert } = fakeDb(undefined, {
        data: [existing({ time_zone: 'Australia/Sydney', country: 'AU', state: 'NV', currency: 'aud' })],
      })
      await upsertEventRows(db, [row()])
      expect(written(upsert)).toEqual({ ...row(), tenant_id: TENANT_B, currency: 'aud', min_participant_age: 16 })
    })

    it('recomputes the time zone as today when a US state is filled in on a synced row', async () => {
      const { db, upsert } = fakeDb(undefined, { data: [existing({ time_zone: 'America/Denver', state: null })] })
      await upsertEventRows(db, [row()])
      expect(written(upsert)).toEqual({ ...row(), tenant_id: TENANT_B, min_participant_age: 16 })
    })

    describe('outside the US the state cannot move the zone, so a state edit keeps it', () => {
      const sydney = (over: Record<string, unknown> = {}) =>
        existing({ time_zone: 'Australia/Sydney', country: 'AU', state: 'NSW', currency: 'aud', ...over })
      const auRow = (state: string | null) => toEventRow({ ...nevada, country: 'AU', state }, undefined, NOW)!
      // Local midnight 6 Nov in Sydney (AEDT, UTC+11) and midnight after 7 Nov.
      const inSydney = { time_zone: 'Australia/Sydney', starts_at: '2026-11-05T13:00:00.000Z', ends_at: '2026-11-07T13:00:00.000Z' }

      it('keeps the zone when the state is written another way', async () => {
        const { db, upsert } = fakeDb(undefined, { data: [sydney()] })
        await upsertEventRows(db, [auRow('New South Wales')])
        expect(written(upsert)).toEqual({ ...auRow('New South Wales'), tenant_id: TENANT_B, min_participant_age: 16, ...inSydney })
      })

      it('keeps the zone when a state is added', async () => {
        const { db, upsert } = fakeDb(undefined, { data: [sydney({ state: null })] })
        await upsertEventRows(db, [auRow('NSW')])
        expect(written(upsert)).toMatchObject(inSydney)
      })

      it('still recomputes when the country changed', async () => {
        const { db, upsert } = fakeDb(undefined, { data: [sydney({ country: 'NZ' })] })
        await upsertEventRows(db, [auRow('NSW')])
        expect(written(upsert)).toEqual({ ...auRow('NSW'), tenant_id: TENANT_B, min_participant_age: 16 })
        expect(written(upsert).time_zone).toBe('America/Denver')
      })
    })

    describe('a seeded row (never synced from Sanity, so no earlier state) keeps its zone on its first sync', () => {
      it('a US row with no stored state keeps its zone and dates the event in it', async () => {
        const { db, upsert } = fakeDb(undefined, {
          data: [existing({ time_zone: 'America/Denver', state: null, source_updated_at: null })],
        })
        await upsertEventRows(db, [row()])
        expect(written(upsert)).toEqual({
          ...row(),
          tenant_id: TENANT_B,
          min_participant_age: 16,
          time_zone: 'America/Denver',
          starts_at: '2026-11-06T07:00:00.000Z',
          ends_at: '2026-11-08T07:00:00.000Z',
        })
      })

      it('an AU row seeded like the two-tenant fixture keeps its zone and minimum age', async () => {
        const { db, upsert } = fakeDb(undefined, {
          data: [
            existing({
              time_zone: 'Australia/Sydney',
              country: 'AU',
              state: null,
              currency: 'aud',
              min_participant_age: 14,
              source_updated_at: null,
            }),
          ],
        })
        const au = toEventRow({ ...nevada, country: 'AU', state: 'NSW' }, undefined, NOW)!
        await upsertEventRows(db, [au])
        expect(written(upsert)).toMatchObject({
          tenant_id: TENANT_B,
          min_participant_age: 14,
          time_zone: 'Australia/Sydney',
          starts_at: '2026-11-05T13:00:00.000Z',
          ends_at: '2026-11-07T13:00:00.000Z',
        })
      })

      it('still recomputes when the seeded country differs from the document', async () => {
        const { db, upsert } = fakeDb(undefined, {
          data: [existing({ time_zone: 'Australia/Sydney', country: 'AU', state: null, currency: 'aud', source_updated_at: null })],
        })
        await upsertEventRows(db, [row()])
        expect(written(upsert)).toEqual({ ...row(), tenant_id: TENANT_B, currency: 'aud', min_participant_age: 16 })
      })
    })

    it('recomputes the time zone when the stored one is not a real zone', async () => {
      const { db, upsert } = fakeDb(undefined, { data: [existing({ time_zone: 'Nowhere/Atlantis' })] })
      await upsertEventRows(db, [row()])
      expect(written(upsert).time_zone).toBe('America/Los_Angeles')
      expect(written(upsert).starts_at).toBe(row().starts_at)
    })

    it('a brand-new row defaults to Stellr as today', async () => {
      const { db, upsert } = fakeDb()
      await syncEventFromSanity(db, { sanityId: 'evt-nevada' }, { fetcher: async () => nevada, now: NOW })
      expect(written(upsert)).toEqual(toEventRow(nevada, undefined, NOW))
      expect(written(upsert)).toMatchObject({ tenant_id: STELLR_TENANT_ID, min_participant_age: null, time_zone: 'America/Los_Angeles' })
    })
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
