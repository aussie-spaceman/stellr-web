import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'

vi.mock('server-only', () => ({}))
const session = vi.hoisted(() => ({ value: { userId: 'user_s' as string | null, sessionClaims: { metadata: { role: 'staff' } } as unknown } }))
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => session.value }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => { throw new Error('pass a db') } }))

const { cleanDetail, logRecordAccess } = await import('./record-access-log')

describe('record access log', () => {
  beforeEach(() => {
    session.value = { userId: 'user_s', sessionClaims: { metadata: { role: 'staff' } } }
  })
  it('keeps the detail ID-only: anything that looks like personal data is dropped', () => {
    expect(cleanDetail({ kind: 'roster_csv', first_name: 'x', guardianEmail: 'x', dob: 'x', medicalNotes: 'x', filters: 'grade,role' })).toEqual({ kind: 'roster_csv', filters: 'grade,role' })
    expect(cleanDetail({ email: 'x' })).toBeNull()
  })
  it('records who looked, as which role, and what, by IDs', async () => {
    const db = fakeSupabase({ record_access_log: [] })
    await logRecordAccess({ action: 'minor_record_view', route: '/admin/members/[id]', subjectMemberId: 'm1' }, db.client)
    expect(db.table('record_access_log')).toMatchObject([{ actor: 'user_s', actor_role: 'staff', action: 'minor_record_view', subject_member_id: 'm1', subject_event: null, route: '/admin/members/[id]' }])
  })
  it('writes nothing for a signed-out request, and never throws on a failed write', async () => {
    const db = fakeSupabase({ record_access_log: [] })
    session.value = { userId: null, sessionClaims: null }
    await logRecordAccess({ action: 'export', route: '/x' }, db.client)
    expect(db.table('record_access_log')).toEqual([])
    session.value = { userId: 'user_s', sessionClaims: null }
    const broken = fakeSupabase({}, { failOn: () => 'down' })
    await expect(logRecordAccess({ action: 'export', route: '/x' }, broken.client)).resolves.toBeUndefined()
  })
})
