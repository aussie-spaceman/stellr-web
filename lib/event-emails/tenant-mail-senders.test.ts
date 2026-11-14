// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { loadTenantSenders, readTenantSenders, TENANT_SENDERS_PAGE_SIZE } from './tenant-mail'

// B14b follow-up: loadTenantSenders reads every non-Stellr tenant in ordered
// pages, so the map stays whole past PostgREST's row cap (an unpaged read would
// stop at it), and a failed page empties the map rather than leaving it partial.

const uuid = (i: number) => `22222222-0000-4000-8000-${String(i).padStart(12, '0')}`

/** `n` tenants; every third has no Reply-To, so no sender. Stellr first. */
function tenants(n: number) {
  return [
    { id: STELLR_TENANT_ID, display_name: 'Stellr Education', branding: { reply_to: 'stellr@example.org' } },
    ...Array.from({ length: n }, (_, i) => ({
      id: uuid(i + 1),
      display_name: `Club ${i + 1}`,
      branding: i % 3 === 2 ? {} : { reply_to: `club${i + 1}@example.org` },
    })),
  ]
}

beforeEach(() => {
  vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('loadTenantSenders paging', () => {
  it('the page size is well under PostgREST’s 1,000-row cap', () => {
    expect(TENANT_SENDERS_PAGE_SIZE).toBeLessThanOrEqual(500)
  })

  it('reads more tenants than one page, and more than the row cap, in ordered pages', async () => {
    const n = 1205
    // maxRows stands in for PostgREST's cap: no single read returns more.
    const db = fakeSupabase({ tenants: tenants(n) }, { maxRows: 1000 })
    const from = vi.spyOn(db.client as unknown as { from: (t: string) => unknown }, 'from')
    const senders = await loadTenantSenders(db.client as never)
    const expected = Array.from({ length: n }, (_, i) => i).filter((i) => i % 3 !== 2).length
    expect(senders.size).toBe(expected)
    expect(senders.has(STELLR_TENANT_ID)).toBe(false)
    expect(senders.get(uuid(1))).toEqual({ from: '"Club 1 via Stellr" <no-reply@mail.stellreducation.org>', replyTo: 'club1@example.org' })
    expect(senders.has(uuid(n))).toBe(true)
    expect(from).toHaveBeenCalledTimes(Math.ceil(n / TENANT_SENDERS_PAGE_SIZE))
  })

  it('a list that ends exactly on a page boundary takes one more (empty) read and stops', async () => {
    const db = fakeSupabase({ tenants: tenants(TENANT_SENDERS_PAGE_SIZE) })
    const from = vi.spyOn(db.client as unknown as { from: (t: string) => unknown }, 'from')
    const senders = await loadTenantSenders(db.client as never)
    expect(senders.size).toBe(Array.from({ length: TENANT_SENDERS_PAGE_SIZE }, (_, i) => i).filter((i) => i % 3 !== 2).length)
    expect(from).toHaveBeenCalledTimes(2)
  })

  it('a failed read: loadTenantSenders is empty and never throws; readTenantSenders throws', async () => {
    const db = fakeSupabase({ tenants: tenants(5) }, { failOn: (t) => (t === 'tenants' ? 'tenants unreadable' : null) })
    expect((await loadTenantSenders(db.client as never)).size).toBe(0)
    await expect(readTenantSenders(db.client as never)).rejects.toThrow('tenants unreadable')
  })

  it('flag off: reads nothing, as before', async () => {
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', '')
    const db = fakeSupabase({ tenants: tenants(5) })
    const from = vi.spyOn(db.client as unknown as { from: (t: string) => unknown }, 'from')
    expect((await loadTenantSenders(db.client as never)).size).toBe(0)
    expect((await readTenantSenders(db.client as never)).size).toBe(0)
    expect(from).not.toHaveBeenCalled()
  })
})
