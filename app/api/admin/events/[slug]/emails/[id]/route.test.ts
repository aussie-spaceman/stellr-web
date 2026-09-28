import { describe, it, expect, vi, beforeEach } from 'vitest'

const { requireEventAccess, row, updates } = vi.hoisted(() => ({
  requireEventAccess: vi.fn(async (_s: string): Promise<{ ok: boolean; status: number }> => ({ ok: true, status: 200 })),
  row: { current: null as Record<string, unknown> | null },
  updates: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/community', () => ({ tiptapToPlainText: () => '', RESOURCES_BUCKET: 'community-resources' }))
vi.mock('@/lib/event-access', () => ({ requireEventAccess }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    storage: { from: () => ({ remove: async () => ({}) }) },
    from: () => {
      const filters: Record<string, unknown> = {}
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, v: unknown) => { filters[col] = v; return chain },
        in: () => chain,
        maybeSingle: async () => {
          const r = row.current
          if (!r || (filters.event_slug && r.event_slug !== filters.event_slug)) return { data: null }
          return { data: pending ? { ...r, ...pending } : r }
        },
        update: (values: Record<string, unknown>) => { updates.push(values); pending = values; return chain },
        delete: () => chain,
      }
      let pending: Record<string, unknown> | null = null
      return chain
    },
  }),
}))

const { PATCH } = await import('./route')

const DRAFT = {
  id: 'e1', event_slug: 'colorado', name: 'Chase', subject: '{{event_name}}', body_json: null,
  audiences: ['docusign_outstanding'], attachments: [], resend_docusign: true, schedule_days_before: null, status: 'draft',
}

function patch(body: unknown, slug = 'colorado') {
  return PATCH(
    new Request('https://x/api', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ slug, id: 'e1' }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  updates.length = 0
  row.current = { ...DRAFT }
  requireEventAccess.mockResolvedValue({ ok: true, status: 200 })
})

describe('PATCH /api/admin/events/[slug]/emails/[id]', () => {
  it('403s an event manager on another event', async () => {
    requireEventAccess.mockResolvedValue({ ok: false, status: 403 })
    expect((await patch({ name: 'x' })).status).toBe(403)
  })

  it('404s an email that belongs to a different event', async () => {
    expect((await patch({ name: 'x' }, 'texas')).status).toBe(404)
    expect(updates).toEqual([])
  })

  it('refuses to edit a sent email', async () => {
    row.current = { ...DRAFT, status: 'sent' }
    expect((await patch({ subject: 'new' })).status).toBe(409)
  })

  it('will not schedule without a day count', async () => {
    const res = await patch({ status: 'scheduled' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('days before') })
  })

  it('will not schedule with an unknown merge field', async () => {
    const res = await patch({ status: 'scheduled', schedule_days_before: 5, subject: 'Hi {{firstName}}' })
    expect(res.status).toBe(400)
  })

  it('schedules a complete email', async () => {
    const res = await patch({ status: 'scheduled', schedule_days_before: 5 })
    expect(res.status).toBe(200)
    expect(updates[0]).toMatchObject({ status: 'scheduled', schedule_days_before: 5 })
  })

  it('rejects an unknown group', async () => {
    expect((await patch({ audiences: ['everyone'] })).status).toBe(400)
  })
})
