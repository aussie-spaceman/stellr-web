import { describe, it, expect, vi, beforeEach } from 'vitest'

const authMock = vi.fn()
const getCurrentMemberMock = vi.fn()
const assertNotImpersonatingMock = vi.fn()
const createSignedUploadUrl = vi.fn()
const download = vi.fn()
const remove = vi.fn()

vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }))
vi.mock('@/lib/community', () => ({
  RESOURCES_BUCKET: 'community-resources',
  getCurrentMember: getCurrentMemberMock,
}))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: assertNotImpersonatingMock }))
vi.mock('@/lib/spaces', () => ({ getSpaceForMember: vi.fn() }))
vi.mock('@/lib/campaign-registrations', () => ({ getMemberCampaignRegistration: vi.fn() }))
vi.mock('@/lib/resource-upload', () => ({ memberManagesContainer: vi.fn() }))
const requireEventAccessMock = vi.fn()
vi.mock('@/lib/event-access', () => ({ requireEventAccess: requireEventAccessMock }))
// The license row the compliance purposes look up (null = none on file).
const licenseRow: { current: { id: string } | null } = { current: null }
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    storage: { from: () => ({ createSignedUploadUrl, download, remove }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: licenseRow.current }) }) }) }),
  }),
}))

const { signUpload, claimUpload, UPLOAD_PURPOSES, safeFileName } = await import('./uploads')

beforeEach(() => {
  vi.clearAllMocks()
  licenseRow.current = null
  assertNotImpersonatingMock.mockResolvedValue(null)
  createSignedUploadUrl.mockResolvedValue({ data: { path: 'p', token: 't' }, error: null })
})

const asAdmin = () => authMock.mockResolvedValue({ sessionClaims: { metadata: { role: 'admin' } } })
const asVisitor = () => authMock.mockResolvedValue({ sessionClaims: {} })

describe('signUpload', () => {
  it('issues a signed URL to an admin', async () => {
    asAdmin()
    const result = await signUpload({
      purpose: 'admin-resource', ctx: {}, fileName: 'a.pdf', fileSize: 1024, contentType: 'application/pdf',
    })
    expect(result).toEqual({ bucket: 'community-resources', path: 'p', token: 't' })
  })

  it('refuses a non-admin on an admin purpose', async () => {
    asVisitor()
    getCurrentMemberMock.mockResolvedValue(null)
    const result = await signUpload({
      purpose: 'admin-resource', ctx: {}, fileName: 'a.pdf', fileSize: 1024, contentType: 'application/pdf',
    })
    expect(result).toEqual({ error: 'Forbidden', status: 403 })
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('refuses an oversize file before signing', async () => {
    asAdmin()
    const result = await signUpload({
      purpose: 'admin-resource', ctx: {}, fileName: 'a.pdf',
      fileSize: UPLOAD_PURPOSES['admin-resource'].maxBytes + 1, contentType: 'application/pdf',
    })
    expect(result).toMatchObject({ status: 413 })
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('enforces the per-purpose type allowlist', async () => {
    asAdmin()
    const result = await signUpload({
      purpose: 'training-cert-template', ctx: { moduleId: 'm1' }, fileName: 'x.exe',
      fileSize: 10, contentType: 'application/x-msdownload',
    })
    expect(result).toMatchObject({ status: 415 })
  })

  // Impersonation is a lens, not a login.
  it('refuses a member purpose while an admin is viewing as someone', async () => {
    asVisitor()
    assertNotImpersonatingMock.mockResolvedValue(new Response('blocked', { status: 403 }))
    const result = await signUpload({
      purpose: 'community-media', ctx: {}, fileName: 'a.png', fileSize: 10, contentType: 'image/png',
    })
    expect(result).toMatchObject({ status: 403 })
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('gives training video real headroom, not the old 4.5MB ceiling', () => {
    expect(UPLOAD_PURPOSES['training-item'].maxBytes).toBeGreaterThan(50 * 1024 * 1024)
  })
})

// Event artwork is signed on event access, not admin role: an assigned event
// manager uploads their own event's certificate templates.
describe('signUpload — event-artwork', () => {
  const sign = (kind: string) =>
    signUpload({ purpose: 'event-artwork', ctx: { slug: 'colorado', kind }, fileName: 'art.png', fileSize: 10, contentType: 'image/png' })

  it('signs for an event manager assigned to the event', async () => {
    requireEventAccessMock.mockResolvedValue({ ok: true, userId: 'u1', isAdmin: false, assignedSlugs: ['colorado'] })
    expect(await sign('certificate-anita_gale')).toEqual({ bucket: 'community-resources', path: 'p', token: 't' })
    expect(requireEventAccessMock).toHaveBeenCalledWith('colorado')
    expect(createSignedUploadUrl.mock.calls[0][0]).toMatch(/^event-artwork\/colorado\/certificate-anita_gale-\d+-art\.png$/)
  })

  it('signs the Norm Chaffee Finalist artwork', async () => {
    requireEventAccessMock.mockResolvedValue({ ok: true, userId: 'u1', isAdmin: false, assignedSlugs: ['colorado'] })
    expect(await sign('certificate-norm_chaffee')).toEqual({ bucket: 'community-resources', path: 'p', token: 't' })
  })

  it('refuses a manager of another event', async () => {
    requireEventAccessMock.mockResolvedValue({ ok: false, status: 403 })
    expect(await sign('certificate-participation')).toEqual({ error: 'Forbidden', status: 403 })
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('refuses an artwork kind that is not a badge or an award', async () => {
    requireEventAccessMock.mockResolvedValue({ ok: true, userId: 'u1', isAdmin: true, assignedSlugs: null })
    expect(await sign('certificate-best_hat')).toMatchObject({ status: 400 })
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })
})

// A theme default is inherited by every event of that theme, so only an admin
// may sign one — an event manager uploads their own event's art instead.
describe('signUpload — artwork-default', () => {
  const sign = (ctx: Record<string, string>) =>
    signUpload({ purpose: 'artwork-default', ctx, fileName: 'art.png', fileSize: 10, contentType: 'image/png' })

  it('signs for an admin, under the theme', async () => {
    asAdmin()
    expect(await sign({ theme: 'environmental', kind: 'certificate-mentor' })).toEqual({ bucket: 'community-resources', path: 'p', token: 't' })
    expect(createSignedUploadUrl.mock.calls[0][0]).toMatch(/^artwork-defaults\/environmental\/certificate-mentor-\d+-art\.png$/)
  })

  it('refuses anyone else, event managers included', async () => {
    authMock.mockResolvedValue({ sessionClaims: { metadata: { role: 'event_manager' } } })
    expect(await sign({ theme: 'space', kind: 'badge' })).toEqual({ error: 'Forbidden', status: 403 })
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('refuses an unknown theme or kind', async () => {
    asAdmin()
    expect(await sign({ theme: 'ocean', kind: 'badge' })).toMatchObject({ status: 400 })
    expect(await sign({ theme: 'space', kind: 'certificate-best_hat' })).toMatchObject({ status: 400 })
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })
})

// An admin attaching a teacher's emailed license: admin-only, into that
// member's own folder, and only once the license details exist.
describe('signUpload — compliance-document-admin', () => {
  const MEMBER = '3f2b8c1e-5d4a-4b6f-9e2d-7a1c0b9d8e6f'
  const sign = (ctx: Record<string, string>) =>
    signUpload({ purpose: 'compliance-document-admin', ctx, fileName: 'licence scan.pdf', fileSize: 10, contentType: 'application/pdf' })

  it("signs into the member's folder in the license bucket", async () => {
    asAdmin()
    licenseRow.current = { id: 'l1' }
    expect(await sign({ memberId: MEMBER })).toEqual({ bucket: 'teacher-licenses', path: 'p', token: 't' })
    expect(createSignedUploadUrl.mock.calls[0][0]).toMatch(new RegExp(`^${MEMBER}/\\d+-licence_scan\\.pdf$`))
  })

  it('refuses a non-admin', async () => {
    asVisitor()
    licenseRow.current = { id: 'l1' }
    expect(await sign({ memberId: MEMBER })).toEqual({ error: 'Forbidden', status: 403 })
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('refuses a member id that is not a uuid (it becomes the path prefix)', async () => {
    asAdmin()
    licenseRow.current = { id: 'l1' }
    expect(await sign({ memberId: '../other' })).toMatchObject({ status: 400 })
    expect(await sign({})).toMatchObject({ status: 400 })
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('refuses before the license details are saved', async () => {
    asAdmin()
    expect(await sign({ memberId: MEMBER })).toMatchObject({ status: 400 })
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('accepts only image and PDF types', async () => {
    asAdmin()
    licenseRow.current = { id: 'l1' }
    const result = await signUpload({
      purpose: 'compliance-document-admin', ctx: { memberId: MEMBER }, fileName: 'x.zip', fileSize: 10, contentType: 'application/zip',
    })
    expect(result).toMatchObject({ status: 415 })
  })
})

describe('claimUpload', () => {
  const storedBytes = (bytes: number[]) =>
    download.mockResolvedValue({ data: { arrayBuffer: async () => new Uint8Array(bytes).buffer }, error: null })

  it('returns the stored bytes', async () => {
    storedBytes([1, 2, 3])
    const result = await claimUpload({ purpose: 'admin-resource', storagePath: 'resources/a.pdf' })
    expect(result).toMatchObject({ bucket: 'community-resources' })
  })

  // The signing step only saw what the browser claimed; this is the real check.
  it('rejects and deletes an object that fails its format check', async () => {
    storedBytes([0x4d, 0x5a, 0x90, 0x00]) // a Windows executable, not a PDF
    const result = await claimUpload({
      purpose: 'compliance-document',
      storagePath: 'member-1/x.pdf',
      verify: (b) => b[0] === 0x25 && b[1] === 0x50,
      verifyError: 'not a pdf',
    })
    expect(result).toEqual({ error: 'not a pdf', status: 400 })
    expect(remove).toHaveBeenCalledWith(['member-1/x.pdf'])
  })

  it('rejects and deletes an empty object', async () => {
    storedBytes([])
    const result = await claimUpload({ purpose: 'admin-resource', storagePath: 'resources/a.pdf' })
    expect(result).toMatchObject({ status: 400 })
    expect(remove).toHaveBeenCalled()
  })

  it('refuses a traversal path without touching storage', async () => {
    const result = await claimUpload({ purpose: 'admin-resource', storagePath: '../../secrets/a.pdf' })
    expect(result).toMatchObject({ status: 400 })
    expect(download).not.toHaveBeenCalled()
  })

  it('reports a missing object rather than recording nothing', async () => {
    download.mockResolvedValue({ data: null, error: { message: 'not found' } })
    const result = await claimUpload({ purpose: 'admin-resource', storagePath: 'resources/gone.pdf' })
    expect(result).toMatchObject({ status: 400 })
  })

  // deep review MEM-13: the caller passes the namespace it authorised; a path
  // outside it (another space, a training folder, an admin file) must be refused
  // before any storage read/remove — otherwise a member could adopt or (if
  // oversize) discard-DELETE an object they never uploaded.
  it('refuses a path outside the caller-authorised prefix without touching storage', async () => {
    const result = await claimUpload({
      purpose: 'space-attachment',
      storagePath: 'training/evil.mp4',
      expectedPrefix: 'community-resources/space-1/',
    })
    expect(result).toMatchObject({ status: 400 })
    expect(download).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it('accepts a path inside the authorised prefix', async () => {
    storedBytes([1, 2, 3])
    const result = await claimUpload({
      purpose: 'space-attachment',
      storagePath: 'community-resources/space-1/123-file.pdf',
      expectedPrefix: 'community-resources/space-1/',
    })
    expect(result).toMatchObject({ bucket: 'community-resources' })
  })

  it('rejects an empty-segment (//) path without touching storage', async () => {
    const result = await claimUpload({ purpose: 'admin-resource', storagePath: 'resources//x.pdf' })
    expect(result).toMatchObject({ status: 400 })
    expect(download).not.toHaveBeenCalled()
  })
})

describe('safeFileName', () => {
  it('strips path separators and traversal', () => {
    expect(safeFileName('../../etc/passwd')).toBe('.._.._etc_passwd')
  })
  it('never returns an empty name', () => {
    expect(safeFileName('///')).toBe('___')
  })
})
