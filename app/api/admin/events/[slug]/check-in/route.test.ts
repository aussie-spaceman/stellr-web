import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OpenCheckIn } from '@/lib/check-in-banner'

const { requireEventAccess, getEventBySlug, loadOpenCheckIns, updates, upserts } = vi.hoisted(() => ({
  requireEventAccess: vi.fn(async (_slug: string): Promise<{ ok: boolean; status: number }> => ({ ok: true, status: 200 })),
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

const { POST } = await import('./route')

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

beforeEach(() => {
  vi.clearAllMocks()
  updates.length = 0
  upserts.length = 0
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
