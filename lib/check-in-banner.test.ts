import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

const getEventsBySlugs = vi.fn()
vi.mock('@/lib/sanity', () => ({ getEventsBySlugs: (...a: unknown[]) => getEventsBySlugs(...a) }))

import { canSeeCheckIn, checkInsVisibleTo, loadOpenCheckIns, loadOpenCheckInsForTenant, pickBannerEvent, type OpenCheckIn } from './check-in-banner'

const open = (over: Partial<OpenCheckIn>): OpenCheckIn => ({
  slug: 'nevada',
  token: 'tok',
  title: 'Nevada',
  date: '2026-11-06',
  endDate: '2026-11-07',
  inPerson: true,
  ...over,
})

describe('pickBannerEvent', () => {
  it('returns null when nothing is open', () => {
    expect(pickBannerEvent([], '2026-11-06')).toBeNull()
  })

  it('returns the one open event', () => {
    const nv = open({})
    expect(pickBannerEvent([nv], '2026-11-06')).toBe(nv)
  })

  it('never sends the banner to a virtual event, an unknown slug, or one with no code', () => {
    expect(pickBannerEvent([open({ inPerson: false })], '2026-11-06')).toBeNull()
    expect(pickBannerEvent([open({ token: null })], '2026-11-06')).toBeNull()
    const nv = open({})
    expect(pickBannerEvent([open({ slug: 'webinar', inPerson: false, date: '2026-11-06' }), nv], '2026-11-06')).toBe(nv)
  })

  it('when two are left open, picks the event nearest today', () => {
    const co = open({ slug: 'colorado', date: '2026-10-03', endDate: '2026-10-04' })
    const nv = open({ slug: 'nevada', date: '2026-11-06', endDate: '2026-11-07' })
    expect(pickBannerEvent([co, nv], '2026-11-05')?.slug).toBe('nevada')
    expect(pickBannerEvent([co, nv], '2026-11-07')?.slug).toBe('nevada') // second day of a two-day event
    expect(pickBannerEvent([co, nv], '2026-10-04')?.slug).toBe('colorado')
  })

  it('puts an undated event last and breaks a tie by slug, so the answer is stable', () => {
    const undated = open({ slug: 'aaa', date: null, endDate: null })
    const dated = open({ slug: 'zzz', date: '2027-03-01', endDate: null })
    expect(pickBannerEvent([undated, dated], '2026-11-06')?.slug).toBe('zzz')
    expect(pickBannerEvent([open({ slug: 'b' }), open({ slug: 'a' })], '2026-11-06')?.slug).toBe('a')
  })
})

describe('loadOpenCheckIns', () => {
  const dbReturning = (result: { data: unknown; error: unknown }) => {
    const eq = vi.fn(() => ({ or: vi.fn().mockResolvedValue(result) }))
    const db = { from: vi.fn(() => ({ select: vi.fn(() => ({ eq })) })) } as unknown as SupabaseClient
    return { db, eq }
  }

  beforeEach(() => getEventsBySlugs.mockReset())

  it('reads only events with check-in switched on, joined with Sanity', async () => {
    const { db, eq } = dbReturning({
      data: [
        { event_slug: 'nevada', check_in_token: 't1' },
        { event_slug: 'webinar', check_in_token: 't2' },
        { event_slug: 'deleted', check_in_token: 't3' },
      ],
      error: null,
    })
    getEventsBySlugs.mockResolvedValue([
      { slug: { current: 'nevada' }, title: 'Nevada SDC', date: '2026-11-06', endDate: '2026-11-07', setting: 'in_person' },
      { slug: { current: 'webinar' }, title: 'Webinar', date: '2026-11-06', setting: 'virtual' },
    ])

    const rows = await loadOpenCheckIns(db)

    expect(eq).toHaveBeenCalledWith('check_in_open', true)
    expect(rows).toEqual([
      { slug: 'nevada', token: 't1', title: 'Nevada SDC', date: '2026-11-06', endDate: '2026-11-07', inPerson: true },
      { slug: 'webinar', token: 't2', title: 'Webinar', date: '2026-11-06', endDate: null, inPerson: false },
      { slug: 'deleted', token: 't3', title: null, date: null, endDate: null, inPerson: false },
    ])
  })

  it('treats an event with no setting as in person', async () => {
    const { db } = dbReturning({ data: [{ event_slug: 'old', check_in_token: 't' }], error: null })
    getEventsBySlugs.mockResolvedValue([{ slug: { current: 'old' }, title: 'Old event' }])
    expect((await loadOpenCheckIns(db))[0].inPerson).toBe(true)
  })

  it('skips Sanity when nothing is open, and throws on a database error', async () => {
    expect(await loadOpenCheckIns(dbReturning({ data: [], error: null }).db)).toEqual([])
    expect(getEventsBySlugs).not.toHaveBeenCalled()
    await expect(loadOpenCheckIns(dbReturning({ data: null, error: { message: 'boom' } }).db)).rejects.toThrow('boom')
  })
})

describe('whose open check-ins', () => {
  const chain = (result: { data: unknown; error: unknown }) => {
    const calls: unknown[][] = []
    const builder = {
      select: () => builder,
      eq: (...a: unknown[]) => (calls.push(['eq', ...a]), builder),
      or: (...a: unknown[]) => (calls.push(['or', ...a]), builder),
      then: (done: (v: unknown) => void) => done(result),
    }
    return { db: { from: () => builder } as unknown as SupabaseClient, calls }
  }
  const NOTHING = { data: [], error: null }

  beforeEach(() => getEventsBySlugs.mockReset())

  it("Stellr's list keeps to Stellr's rows and rows with no tenant, so a tenant's token never reaches its banner", async () => {
    const { db, calls } = chain(NOTHING)
    await loadOpenCheckIns(db)
    expect(calls).toEqual([
      ['eq', 'check_in_open', true],
      ['or', `tenant_id.is.null,tenant_id.eq.${STELLR_TENANT_ID}`],
    ])
  })

  it("a tenant's list reads only that tenant's rows", async () => {
    const { db, calls } = chain(NOTHING)
    await loadOpenCheckInsForTenant(db, 'tenant-a')
    expect(calls).toEqual([
      ['eq', 'check_in_open', true],
      ['eq', 'tenant_id', 'tenant-a'],
    ])
  })

  it("an empty tenant id throws, and doesn't read everyone's", async () => {
    const { db, calls } = chain(NOTHING)
    await expect(loadOpenCheckInsForTenant(db, '')).rejects.toThrow('no tenant id')
    expect(calls).toEqual([])
  })
})

// S0 (Nov 2026): an event manager sees, and closes, only the events they run.
describe('checkInsVisibleTo / canSeeCheckIn', () => {
  const all = [open({ slug: 'colorado' }), open({ slug: 'nevada' }), open({ slug: 'utah' })]

  it('a full admin sees every event', () => {
    expect(checkInsVisibleTo(all, { isAdmin: true, assignedSlugs: null })).toEqual(all)
  })

  it('an event manager sees only their assigned events', () => {
    const viewer = { isAdmin: false, assignedSlugs: ['nevada', 'utah'] }
    expect(checkInsVisibleTo(all, viewer).map((e) => e.slug)).toEqual(['nevada', 'utah'])
    expect(canSeeCheckIn(viewer, 'colorado')).toBe(false)
    expect(canSeeCheckIn(viewer, 'nevada')).toBe(true)
  })

  it('anything short of isAdmin: true sees nothing extra', () => {
    expect(checkInsVisibleTo(all, { isAdmin: false, assignedSlugs: null })).toEqual([])
    expect(checkInsVisibleTo(all, { isAdmin: false, assignedSlugs: [] })).toEqual([])
    expect(checkInsVisibleTo(all, {} as unknown as { isAdmin: boolean; assignedSlugs: null })).toEqual([])
  })
})
