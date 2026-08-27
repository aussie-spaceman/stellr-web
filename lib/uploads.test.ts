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
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    storage: { from: () => ({ createSignedUploadUrl, download, remove }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  }),
}))

const { signUpload, claimUpload, UPLOAD_PURPOSES, safeFileName } = await import('./uploads')

beforeEach(() => {
  vi.clearAllMocks()
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
})

describe('safeFileName', () => {
  it('strips path separators and traversal', () => {
    expect(safeFileName('../../etc/passwd')).toBe('.._.._etc_passwd')
  })
  it('never returns an empty name', () => {
    expect(safeFileName('///')).toBe('___')
  })
})
