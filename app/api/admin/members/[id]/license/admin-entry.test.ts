// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// An admin entering a teacher's license on their behalf (the teacher emailed a
// copy), and viewing the uploaded photo/scan. Entering details or a document
// must never verify: Mark verified stays a separate, deliberate step.

const { isAdmin, logActivity, claimUpload, state } = vi.hoisted(() => ({
  isAdmin: { value: true },
  logActivity: vi.fn(async (_input: { action: string; memberId: string; actorLabel?: string }, _db?: unknown) => {}),
  claimUpload: vi.fn(),
  state: { db: null as unknown },
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ sessionClaims: {} }) }))
vi.mock('@/lib/admin-auth', () => ({ isAdminClaims: () => isAdmin.value }))
vi.mock('@/lib/activity-log', () => ({
  logActivity,
  actorFromAuth: async () => ({ actorType: 'admin', actorMemberId: 'admin1', actorLabel: 'Staff Admin' }),
}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => state.db }))
vi.mock('@/lib/uploads', () => ({ claimUpload }))

const { POST: licensePOST } = await import('./route')
const { GET: documentGET, POST: documentPOST } = await import('./document/route')

const params = { params: Promise.resolve({ id: 'm1' }) }
const post = (handler: (req: Request, ctx: typeof params) => Promise<Response>, body: unknown) =>
  handler(new Request('https://app.test/x', { method: 'POST', body: JSON.stringify(body) }), params)

const verifiedLicense = {
  id: 'lic1', member_id: 'm1', license_number: 'OLD-1', licensing_state: 'UT', expiry_date: '2027-06-30',
  verified_at: '2026-09-01T00:00:00Z', verified_by: 'admin0', verified_label: 'Someone', document_path: 'm1/old.png',
  updated_at: '2026-09-01T00:00:00Z',
}

let db: FakeDb
function seed(licenses: object[] = []) {
  db = fakeSupabase({ members: [{ id: 'm1' }], member_teacher_licenses: licenses })
  state.db = db.client
}

beforeEach(() => {
  vi.clearAllMocks()
  isAdmin.value = true
  claimUpload.mockResolvedValue({ bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), bucket: 'teacher-licenses' })
})

describe('POST /api/admin/members/[id]/license — action save', () => {
  const details = { license_number: 'T-123', licensing_state: 'Utah', expiry_date: '2028-06-30' }

  it('creates the license for a member with none, unverified, and logs the admin', async () => {
    seed()
    const res = await post(licensePOST, { action: 'save', ...details })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.licenseUpdatedAt).toBeTruthy()

    expect(db.table('member_teacher_licenses')).toEqual([
      expect.objectContaining({ member_id: 'm1', license_number: 'T-123', verified_at: null, updated_at: body.licenseUpdatedAt }),
    ])
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'm1', action: 'license_submitted_by_admin', actorLabel: 'Staff Admin' }),
      expect.anything(),
    )
  })

  it('replaces an existing license and clears its verification', async () => {
    seed([verifiedLicense])
    await post(licensePOST, { action: 'save', ...details })
    const rows = db.table('member_teacher_licenses')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ license_number: 'T-123', verified_at: null, verified_by: null, verified_label: null })
  })

  it('names the missing field', async () => {
    seed()
    const res = await post(licensePOST, { action: 'save', ...details, license_number: '  ' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('License number is required')
    expect(db.table('member_teacher_licenses')).toHaveLength(0)
  })

  it('404s an unknown member', async () => {
    seed()
    const res = await licensePOST(
      new Request('https://app.test/x', { method: 'POST', body: JSON.stringify({ action: 'save', ...details }) }),
      { params: Promise.resolve({ id: 'nobody' }) },
    )
    expect(res.status).toBe(404)
  })

  it('is admin-only', async () => {
    seed()
    isAdmin.value = false
    expect((await post(licensePOST, { action: 'save', ...details })).status).toBe(403)
  })
})

describe('/api/admin/members/[id]/license/document', () => {
  it('GET redirects to a short-lived signed URL for the uploaded document', async () => {
    seed([verifiedLicense])
    db.objects.set('teacher-licenses/m1/old.png', new Uint8Array([1]))
    const res = await documentGET(new Request('https://app.test/x'), params)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://storage.test/teacher-licenses/m1/old.png?ttl=600')
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('GET 404s when nothing is uploaded, and is admin-only', async () => {
    seed([{ ...verifiedLicense, document_path: null }])
    expect((await documentGET(new Request('https://app.test/x'), params)).status).toBe(404)
    isAdmin.value = false
    expect((await documentGET(new Request('https://app.test/x'), params)).status).toBe(403)
  })

  it('POST claims the upload in this member\'s folder, replaces the old file and resets verification', async () => {
    seed([verifiedLicense])
    db.objects.set('teacher-licenses/m1/old.png', new Uint8Array([1]))
    const res = await post(documentPOST, { storagePath: 'm1/123-new.pdf', fileType: 'application/pdf' })
    expect(res.status).toBe(200)

    expect(claimUpload).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'compliance-document-admin', storagePath: 'm1/123-new.pdf', expectedPrefix: 'm1/' }),
    )
    expect(db.objects.has('teacher-licenses/m1/old.png')).toBe(false)
    expect(db.table('member_teacher_licenses')[0]).toMatchObject({ document_path: 'm1/123-new.pdf', verified_at: null })
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'license_document_uploaded_by_admin' }),
      expect.anything(),
    )
  })

  it('POST passes on a refused claim (wrong folder, bad bytes) without touching the license', async () => {
    seed([verifiedLicense])
    claimUpload.mockResolvedValueOnce({ error: 'That upload path is not one we issued.', status: 400 })
    const res = await post(documentPOST, { storagePath: 'm2/123-x.pdf', fileType: 'application/pdf' })
    expect(res.status).toBe(400)
    expect(db.table('member_teacher_licenses')[0]).toMatchObject({ document_path: 'm1/old.png', verified_at: verifiedLicense.verified_at })
  })

  it('POST refuses before any license details exist, and refuses other file types', async () => {
    seed()
    expect((await post(documentPOST, { storagePath: 'm1/1-a.pdf', fileType: 'application/pdf' })).status).toBe(400)
    seed([verifiedLicense])
    expect((await post(documentPOST, { storagePath: 'm1/1-a.zip', fileType: 'application/zip' })).status).toBe(400)
    expect(claimUpload).not.toHaveBeenCalled()
  })
})
