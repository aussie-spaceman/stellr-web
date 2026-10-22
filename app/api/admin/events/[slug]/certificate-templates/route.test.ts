import { describe, it, expect, vi, beforeEach } from 'vitest'

// 22 Oct 2026: "Save position" returned "Database error" for every award. It
// sends only the placement, and the route upserted it — but Postgres checks
// NOT NULL on the row an upsert would insert before it finds the conflict, so
// the missing artwork_path failed (23502) even though the row existed. The
// mock below fails an upsert the same way.

const h = vi.hoisted(() => ({
  existing: null as Record<string, unknown> | null,
  calls: [] as { op: string; row: Record<string, unknown>; filters: [string, unknown][] }[],
}))

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => ({
      upsert: async (row: Record<string, unknown>) => {
        h.calls.push({ op: 'upsert', row, filters: [] })
        return row.artwork_path
          ? { error: null }
          : { error: { code: '23502', message: 'null value in column "artwork_path" violates not-null constraint' } }
      },
      update: (row: Record<string, unknown>) => {
        const call = { op: 'update', row, filters: [] as [string, unknown][] }
        h.calls.push(call)
        const chain = {
          eq: (col: string, v: unknown) => (call.filters.push([col, v]), chain),
          then: (onF: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(onF),
        }
        return chain
      },
    }),
  }),
}))
vi.mock('@/lib/event-access', () => ({ requireEventAccess: async () => ({ ok: true }) }))
vi.mock('@/lib/uploads', () => ({ claimUpload: async () => ({ ok: true }) }))
vi.mock('@/lib/event-certificates', () => ({
  loadTemplate: async () => h.existing,
  loadTemplates: async () => [],
}))

const { PUT } = await import('./route')

const slug = 'colorado-space-design-challenge'
function put(body: Record<string, unknown>) {
  return PUT(
    new Request(`https://app.stellreducation.org/api/admin/events/${slug}/certificate-templates`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) },
  )
}

beforeEach(() => {
  h.existing = null
  h.calls = []
})

describe('PUT certificate-templates', () => {
  it('saves a new position on existing artwork as an update, keeping the artwork', async () => {
    h.existing = { award_type: 'norm_chaffee', artwork_path: `event-artwork/${slug}/certificate-norm_chaffee-1-a.png` }
    const res = await put({ awardType: 'norm_chaffee', name_y: 0.6, name_max_width: 0.55, name_size: 36 })

    expect(res.status).toBe(200)
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].op).toBe('update')
    expect(h.calls[0].row).not.toHaveProperty('artwork_path')
    expect(h.calls[0].row).toMatchObject({ name_y: 0.6, name_max_width: 0.55, name_size: 36 })
    expect(h.calls[0].filters).toEqual([['event_slug', slug], ['award_type', 'norm_chaffee']])
  })

  it('replaces artwork on an existing template as an update', async () => {
    h.existing = { award_type: 'participation', artwork_path: `event-artwork/${slug}/certificate-participation-1-a.png` }
    const storagePath = `event-artwork/${slug}/certificate-participation-2-b.png`
    const res = await put({ awardType: 'participation', storagePath, fileType: 'image/png' })

    expect(res.status).toBe(200)
    expect(h.calls.map((c) => c.op)).toEqual(['update'])
    expect(h.calls[0].row.artwork_path).toBe(storagePath)
  })

  it('creates the template on the first artwork upload', async () => {
    const storagePath = `event-artwork/${slug}/certificate-norm_chaffee-1-a.png`
    const res = await put({ awardType: 'norm_chaffee', storagePath, fileType: 'image/png' })

    expect(res.status).toBe(200)
    expect(h.calls.map((c) => c.op)).toEqual(['upsert'])
    expect(h.calls[0].row).toMatchObject({ event_slug: slug, award_type: 'norm_chaffee', artwork_path: storagePath })
  })

  it('refuses a position before any artwork exists', async () => {
    const res = await put({ awardType: 'norm_chaffee', name_y: 0.6 })

    expect(res.status).toBe(400)
    expect(h.calls).toHaveLength(0)
  })
})
