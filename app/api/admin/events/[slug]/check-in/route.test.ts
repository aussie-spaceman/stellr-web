import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OpenCheckIn } from '@/lib/check-in-banner'

type Access = { ok: boolean; status?: number; isAdmin?: boolean; assignedSlugs?: string[] | null }
const ADMIN: Access = { ok: true, isAdmin: true, assignedSlugs: null }

const { requireEventAccess, getEventBySlug, loadOpenCheckIns, updates, upserts } = vi.hoisted(() => ({
  requireEventAccess: vi.fn(async (_slug: string): Promise<Access> => ({ ok: true, isAdmin: true, assignedSlugs: null })),
  getEventBySlug: vi.fn(async (_slug: string): Promise<{ setting?: string } | null> => ({ setting: 'in_person' })),
  loadOpenCheckIns: vi.fn(async (_db: unknown): Promise<OpenCheckIn[]> => []),
  updates: [] as { values: unknown; column: string; slugs: string[] }[],
  upserts: [] as unknown[],
}))

vi.mock('@/lib/event-access', () => ({ requireEventAccess }))
vi.mock('@/lib/sanity', () => ({ getEventBySlug }))
vi.mock('@/lib/check-in-banner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/check-in-banner')>()),
  loadOpenCheckIns,
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        neq: () => chain,
        not: () => chain,
        // GET's list reads (registrations, merch) come back empty.
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
        maybeSingle: async () => ({ data: { check_in_token: 'existing' }, error: null }),
        update: (values: unknown) => ({
          in: async (column: string, slugs: string[]) => {
            updates.push({ values, column, slugs })
            return { error: null }
          },
        }),
        upsert: async (row: unknown) => {
          upserts.push(row)
          return { error: null }
        },
      }
      return chain
    },
  }),
}))

const { GET, POST } = await import('./route')

const openRow = (over: Partial<OpenCheckIn>): OpenCheckIn => ({
  slug: 'colorado',
  token: 't',
  title: 'Colorado SDC',
  date: '2026-10-03',
  endDate: null,
  inPerson: true,
  ...over,
})

function post(body: unknown, slug = 'nevada') {
  return POST(
    new Request(`https://www.stellreducation.org/api/admin/events/${slug}/check-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) }
  )
}

function get(slug = 'nevada') {
  return GET(new Request(`https://www.stellreducation.org/api/admin/events/${slug}/check-in`), {
    params: Promise.resolve({ slug }),
  })
}

/** An event manager assigned to these events. */
const manager = (...assignedSlugs: string[]): Access => ({ ok: true, isAdmin: false, assignedSlugs })

beforeEach(() => {
  vi.clearAllMocks()
  updates.length = 0
  upserts.length = 0
  requireEventAccess.mockResolvedValue(ADMIN)
  getEventBySlug.mockResolvedValue({ setting: 'in_person' })
  loadOpenCheckIns.mockResolvedValue([])
})

describe('POST /api/admin/events/[slug]/check-in — open', () => {
  it('closes every other in-person event, so the banner has one place to go', async () => {
    loadOpenCheckIns.mockResolvedValue([
      openRow({}),
      openRow({ slug: 'nevada', title: 'Nevada SDC' }),
      openRow({ slug: 'webinar', title: 'Webinar', inPerson: false }),
    ])
    const res = await post({ action: 'open' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, closed: [{ slug: 'colorado', title: 'Colorado SDC' }] })
    expect(updates).toEqual([{ values: { check_in_open: false }, column: 'event_slug', slugs: ['colorado'] }])
    expect(upserts).toEqual([{ event_slug: 'nevada', check_in_open: true }])
  })

  it('touches nothing else when no other event is open', async () => {
    const res = await post({ action: 'open' })
    expect(await res.json()).toEqual({ ok: true, closed: [] })
    expect(updates).toEqual([])
  })

  it('opening a virtual event leaves the in-person one open', async () => {
    getEventBySlug.mockResolvedValue({ setting: 'virtual' })
    loadOpenCheckIns.mockResolvedValue([openRow({})])
    await post({ action: 'open' }, 'webinar')
    expect(loadOpenCheckIns).not.toHaveBeenCalled()
    expect(updates).toEqual([])
    expect(upserts).toEqual([{ event_slug: 'webinar', check_in_open: true }])
  })

  it('does not open when the other events could not be read', async () => {
    loadOpenCheckIns.mockRejectedValue(new Error('boom'))
    expect((await post({ action: 'open' })).status).toBe(500)
    expect(upserts).toEqual([])
  })

  it('closing or regenerating never touches other events', async () => {
    loadOpenCheckIns.mockResolvedValue([openRow({})])
    await post({ action: 'close' })
    await post({ action: 'regenerate' })
    expect(loadOpenCheckIns).not.toHaveBeenCalled()
    expect(updates).toEqual([])
  })

  it('403s without event access', async () => {
    requireEventAccess.mockResolvedValue({ ok: false, status: 403 })
    expect((await post({ action: 'open' })).status).toBe(403)
    expect(upserts).toEqual([])
  })
})

// S0 (Nov 2026): opening closed check-in at EVERY other in-person event, and the
// desk listed every open event, for any event manager — who could shut the
// doors on, and read the names of, events they don't run.
describe('check-in is scoped to the events the caller manages', () => {
  const openElsewhere = () => [
    openRow({}), // colorado
    openRow({ slug: 'utah', title: 'Utah SDC' }),
    openRow({ slug: 'nevada', title: 'Nevada SDC' }),
  ]

  it('an event manager opening their event leaves events they don’t manage open', async () => {
    requireEventAccess.mockResolvedValue(manager('nevada'))
    loadOpenCheckIns.mockResolvedValue(openElsewhere())
    const res = await post({ action: 'open' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, closed: [] })
    expect(updates).toEqual([])
    expect(upserts).toEqual([{ event_slug: 'nevada', check_in_open: true }])
  })

  it('an event manager closes their own other events, and only those', async () => {
    requireEventAccess.mockResolvedValue(manager('nevada', 'utah'))
    loadOpenCheckIns.mockResolvedValue(openElsewhere())
    const res = await post({ action: 'open' })
    expect(await res.json()).toEqual({ ok: true, closed: [{ slug: 'utah', title: 'Utah SDC' }] })
    expect(updates).toEqual([{ values: { check_in_open: false }, column: 'event_slug', slugs: ['utah'] }])
  })

  it('a full admin still closes every other in-person event', async () => {
    loadOpenCheckIns.mockResolvedValue(openElsewhere())
    await post({ action: 'open' })
    expect(updates).toEqual([{ values: { check_in_open: false }, column: 'event_slug', slugs: ['colorado', 'utah'] }])
  })

  it('a caller with no assignment list closes nothing (fails closed)', async () => {
    requireEventAccess.mockResolvedValue({ ok: true, isAdmin: false })
    loadOpenCheckIns.mockResolvedValue(openElsewhere())
    await post({ action: 'open' })
    expect(updates).toEqual([])
  })

  it('GET lists only the event manager’s own other open events', async () => {
    requireEventAccess.mockResolvedValue(manager('nevada', 'utah'))
    loadOpenCheckIns.mockResolvedValue(openElsewhere())
    const body = await (await get()).json()
    expect(body.otherOpen).toEqual([{ slug: 'utah', title: 'Utah SDC' }])
    expect(JSON.stringify(body)).not.toMatch(/colorado|Colorado SDC/)
  })

  it('GET lists every other open event for a full admin', async () => {
    loadOpenCheckIns.mockResolvedValue(openElsewhere())
    const body = await (await get()).json()
    expect(body.otherOpen.map((e: { slug: string }) => e.slug)).toEqual(['colorado', 'utah'])
  })

  it('GET still says whether the banner points here, without naming where else', async () => {
    requireEventAccess.mockResolvedValue(manager('nevada'))
    // Colorado is today's event, so the banner goes there, not to Nevada.
    loadOpenCheckIns.mockResolvedValue([
      openRow({ date: new Date().toISOString().slice(0, 10) }),
      openRow({ slug: 'nevada', title: 'Nevada SDC', date: '2099-01-01' }),
    ])
    const body = await (await get()).json()
    expect(body.bannerTarget).toBe(false)
    expect(body.otherOpen).toEqual([])
  })
})
