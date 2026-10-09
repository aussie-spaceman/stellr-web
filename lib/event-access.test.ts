// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// deep review TEST-2: requireEventAccess is the only automated gate on 33 admin
// event routes (proxy.ts covers pages, not /api/admin/*, and the server uses
// service_role so RLS never applies). Every route test replaces it with
// vi.fn(() => ({ ok: true })), so nothing proved the real helper refuses an
// event manager on an event they are not assigned to, or refuses a non-manager.
// These pin that behaviour against the real implementation.

const authMock = vi.fn()
let db: FakeDb
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock() }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => db.client }))

import { requireEventAccess } from './event-access'

const em = { userId: 'u-em', sessionClaims: { metadata: { role: 'event_manager' } } }

beforeEach(() => {
  db = fakeSupabase({ event_manager_assignments: [{ clerk_user_id: 'u-em', event_slug: 'colorado' }] })
  authMock.mockReset()
})

describe('requireEventAccess', () => {
  it('401s with no session', async () => {
    authMock.mockResolvedValue({ userId: null, sessionClaims: null })
    expect(await requireEventAccess('colorado')).toEqual({ ok: false, status: 401 })
  })

  it('lets a platform admin into any event, with assignedSlugs = null (all events)', async () => {
    authMock.mockResolvedValue({ userId: 'u-admin', sessionClaims: { metadata: { role: 'admin' } } })
    expect(await requireEventAccess('nevada')).toMatchObject({ ok: true, isAdmin: true, assignedSlugs: null })
  })

  it('lets an event manager into their own event', async () => {
    authMock.mockResolvedValue(em)
    expect(await requireEventAccess('colorado')).toMatchObject({ ok: true, isAdmin: false, assignedSlugs: ['colorado'] })
  })

  it('refuses an event manager on an event they are not assigned to', async () => {
    authMock.mockResolvedValue(em)
    expect(await requireEventAccess('nevada')).toEqual({ ok: false, status: 403 })
  })

  it('refuses a member, a mentor, or anyone with no Clerk event-manager/admin role', async () => {
    for (const role of ['member', 'mentor', undefined]) {
      authMock.mockResolvedValue({ userId: 'u', sessionClaims: { metadata: { role } } })
      expect(await requireEventAccess('colorado')).toEqual({ ok: false, status: 403 })
    }
  })

  it('list access (no slug) hands back only the assigned slugs, never null (null = all events)', async () => {
    authMock.mockResolvedValue(em)
    const r = await requireEventAccess()
    expect(r).toMatchObject({ ok: true, isAdmin: false, assignedSlugs: ['colorado'] })
  })
})
