import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkSlugRenameIsSafe } from './event'

// The slug guard runs on every edit to an event in the Studio, so it must only
// reach the app's API (a Vercel function run) when the slug really changes.

function studioContext(id: string, publishedSlug: string | null) {
  const fetchPublished = vi.fn(async () => publishedSlug)
  const withConfig = vi.fn(() => ({
    fetch: fetchPublished as unknown as <T>(query: string, params: Record<string, unknown>) => Promise<T>,
  }))
  return {
    context: { document: { _id: `drafts.${id}` }, getClient: () => ({ withConfig }) },
    fetchPublished,
    withConfig,
  }
}

const serverFetch = vi.fn()

beforeEach(() => {
  serverFetch.mockReset()
  serverFetch.mockResolvedValue(new Response(JSON.stringify({ blocked: false }), { status: 200 }))
  vi.stubGlobal('fetch', serverFetch)
})

describe('checkSlugRenameIsSafe', () => {
  it('does not call the server when the slug matches the published one', async () => {
    const { context, withConfig } = studioContext('evt-same', 'nevada-sdc')
    expect(await checkSlugRenameIsSafe('nevada-sdc', context)).toBe(true)
    expect(withConfig).toHaveBeenCalledWith({ perspective: 'published' })
    expect(serverFetch).not.toHaveBeenCalled()
  })

  it('does not call the server for a document that was never published', async () => {
    const { context } = studioContext('evt-new', null)
    expect(await checkSlugRenameIsSafe('brand-new-event', context)).toBe(true)
    expect(serverFetch).not.toHaveBeenCalled()
  })

  it('asks the server about a real rename, once per slug, and returns its block message', async () => {
    serverFetch.mockResolvedValue(
      new Response(JSON.stringify({ blocked: true, message: 'Renaming this slug would orphan 3 rows' }), { status: 200 }),
    )
    const { context, fetchPublished } = studioContext('evt-rename', 'colorado-sdc')
    expect(await checkSlugRenameIsSafe('colorado-sdc-2026', context)).toBe('Renaming this slug would orphan 3 rows')
    expect(await checkSlugRenameIsSafe('colorado-sdc-2026', context)).toBe('Renaming this slug would orphan 3 rows')
    expect(serverFetch).toHaveBeenCalledTimes(1)
    expect(serverFetch.mock.calls[0][0]).toBe('/api/admin/events/slug-guard?id=evt-rename&slug=colorado-sdc-2026')
    expect(fetchPublished).toHaveBeenCalledTimes(1)
  })

  it('falls back to the server when the Studio client is unavailable', async () => {
    expect(await checkSlugRenameIsSafe('texas-sdc', { document: { _id: 'evt-noclient' } })).toBe(true)
    expect(serverFetch).toHaveBeenCalledTimes(1)
  })
})
