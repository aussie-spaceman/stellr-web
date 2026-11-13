import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

const h = vi.hoisted(() => ({ admin: true }))
let db: FakeDb
vi.mock('@/lib/authz', () => ({ isStellrAdmin: async () => h.admin }))
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'user_admin' }) }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => db.client }))
vi.mock('@/lib/audit/route', () => ({ withAudit: (_spec: unknown, fn: unknown) => fn }))

const { GET, PUT } = await import('./route')
const MOD = '11111111-1111-4111-8111-111111111111'
const put = (body: unknown) => PUT(new Request('https://app.test/api/admin/staff-settings', { method: 'PUT', body: JSON.stringify(body) }))

beforeEach(() => {
  h.admin = true
  db = fakeSupabase({ staff_role_settings: [{ id: true, training_module_id: null }], training_modules: [{ id: MOD, title: 'Safeguarding' }], members: [{ id: 'm-admin', clerk_user_id: 'user_admin' }] })
})

describe('/api/admin/staff-settings', () => {
  it('is admin only, both ways', async () => {
    h.admin = false
    expect((await GET()).status).toBe(403)
    expect((await put({ trainingModuleId: MOD })).status).toBe(403)
    expect(db.table('staff_role_settings')[0].training_module_id).toBeNull()
  })
  it('reads the setting and the modules, and saves a choice', async () => {
    expect(await (await GET()).json()).toEqual({ trainingModuleId: null, modules: [{ id: MOD, title: 'Safeguarding' }] })
    expect((await put({ trainingModuleId: MOD })).status).toBe(200)
    expect(db.table('staff_role_settings')[0]).toMatchObject({ training_module_id: MOD, updated_by: 'm-admin' })
  })
  it('refuses anything but a module id or null', async () => {
    expect((await put({ trainingModuleId: 'not-a-uuid' })).status).toBe(400)
  })
})
