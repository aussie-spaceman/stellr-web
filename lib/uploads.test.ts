import { describe, it, expect, vi, beforeEach } from 'vitest'

const authMock = vi.fn()
const getCurrentMemberMock = vi.fn()
const assertNotImpersonatingMock = vi.fn()
const getRegistrationMock = vi.fn()
const createSignedUploadUrl = vi.fn()
const download = vi.fn()
const remove = vi.fn()

vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }))
vi.mock('@/lib/community', () => ({
  RESOURCES_BUCKET: 'community-resources',
  getCurrentMember: getCurrentMemberMock,
}))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: assertNotImpersonatingMock }))
const getSpaceForMemberMock = vi.fn()
const memberManagesContainerMock = vi.fn()
vi.mock('@/lib/spaces', () => ({ getSpaceForMember: getSpaceForMemberMock }))
vi.mock('@/lib/campaign-registrations', () => ({ getMemberCampaignRegistration: getRegistrationMock }))
vi.mock('@/lib/resource-upload', () => ({ memberManagesContainer: memberManagesContainerMock }))
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

const {
  FILE_NAME_TOO_LONG, signUpload, claimUpload, UPLOAD_PURPOSES, safeFileName, spaceAttachmentPrefix, contributionPrefix,
  isUploadPurpose,
} = await import('./uploads')
type UploadPurpose = import('./uploads').UploadPurpose
type FileFormat = import('./file-sniff').FileFormat
const { sniffFileFormat } = await import('./file-sniff')
const {
  EXCEL_CLSID, FORMAT_SAMPLES, HOSTILE_SAMPLES, OUTLOOK_ICS, SAMPLE_NAMES, WORD_CLSID, bytes, compoundFile, encryptedOoxml,
  threeMf, workbookStream, zipOf,
} = await import('@/test/file-fixtures')

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

// The bytes, and the type storage serves them under, of the object claimUpload reads.
const stored = (bytes: Uint8Array | number[], type = 'application/octet-stream') => {
  const copy = Uint8Array.from(bytes)
  download.mockResolvedValue({ data: { arrayBuffer: async () => copy.buffer, type }, error: null })
}

const ALL_FORMATS = Object.keys(FORMAT_SAMPLES) as FileFormat[]
const PURPOSES = Object.keys(UPLOAD_PURPOSES) as UploadPurpose[]
const DEFAULT_FORMAT_ERROR = 'That file isn’t a type accepted here, or its contents don’t match its name.'

describe('claimUpload', () => {
  it('returns the stored bytes and the format they are', async () => {
    stored(FORMAT_SAMPLES.pdf, 'application/pdf')
    const result = await claimUpload({ purpose: 'admin-resource', storagePath: 'resources/1-a.pdf' })
    expect(result).toMatchObject({ bucket: 'community-resources', format: 'pdf' })
    expect(remove).not.toHaveBeenCalled()
  })

  // The signing step only saw what the browser claimed; this is the real check.
  it('rejects and deletes an object that fails its format check', async () => {
    stored(HOSTILE_SAMPLES['a Windows executable'], 'application/pdf') // an .exe, not a PDF
    const result = await claimUpload({ purpose: 'compliance-document', storagePath: 'member-1/x.pdf' })
    expect(result).toEqual({ error: UPLOAD_PURPOSES['compliance-document'].formatError, status: 415 })
    expect(remove).toHaveBeenCalledWith(['member-1/x.pdf'])
  })

  it('rejects and deletes an empty object', async () => {
    stored([])
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
    stored(FORMAT_SAMPLES.pdf)
    const result = await claimUpload({
      purpose: 'space-attachment',
      storagePath: 'community-resources/space-1/123-file.pdf',
      expectedPrefix: 'community-resources/space-1/',
    })
    expect(result).toMatchObject({ bucket: 'community-resources' })
  })

  // Text is read end to end, which at 25MB is most of a second. A purpose that
  // takes no text (a proposal, a post image) refuses a text file without that.
  it('refuses text for a purpose that takes none without reading it all', async () => {
    stored(new Uint8Array(2 * 1024 * 1024).fill(0x0a).fill(0x61, 0, 1))
    const decode = vi.spyOn(TextDecoder.prototype, 'decode')
    try {
      const result = await claimUpload({ purpose: 'campaign-proposal', storagePath: 'nevada/r1/1-proposal.pdf' })
      expect(result).toEqual({ error: UPLOAD_PURPOSES['campaign-proposal'].formatError, status: 415 })
      const longest = Math.max(0, ...decode.mock.calls.map(([input]) => (input as Uint8Array | undefined)?.byteLength ?? 0))
      expect(longest).toBeLessThanOrEqual(4096)
    } finally {
      decode.mockRestore()
    }
    expect(remove).toHaveBeenCalledWith(['nevada/r1/1-proposal.pdf'])
  })

  it('rejects an empty-segment (//) path without touching storage', async () => {
    const result = await claimUpload({ purpose: 'admin-resource', storagePath: 'resources//x.pdf' })
    expect(result).toMatchObject({ status: 400 })
    expect(download).not.toHaveBeenCalled()
  })

  // storage-js puts the path in the request URL unencoded, and the URL parser
  // resolves `%2e%2e`, `.%2e`, `%2e` and `.` segments, drops tabs and newlines,
  // and ends the path at `?` or `#`. Each of these starts with the member's own
  // folder, so a string check passed it, yet storage would read (and watermark,
  // overwriting) another member's file, or adopt an object a second time under
  // another name.
  it.each([
    `${contributionPrefix('m1')}%2e%2e/m2/1-x.pdf`,
    `${contributionPrefix('m1')}.%2e/m2/1-x.pdf`,
    `${contributionPrefix('m1')}%2E%2E/%2E%2E/1-x.pdf`,
    `${contributionPrefix('m1')}.\t./m2/1-x.pdf`,
    `${contributionPrefix('m1')}./1-x.pdf`,
    `${contributionPrefix('m1')}%2e/1-x.pdf`,
    `${contributionPrefix('m1')}1-x.pdf?v=2`,
    `${contributionPrefix('m1')}1-x.pdf#v2`,
    `${contributionPrefix('m1')}1-x.pdf `,
  ])('refuses %j, which storage would resolve to another path, without touching storage', async (storagePath) => {
    stored(FORMAT_SAMPLES.pdf, 'application/pdf')
    const result = await claimUpload({
      purpose: 'container-contribution',
      storagePath,
      expectedPrefix: contributionPrefix('m1'),
    })
    expect(result).toEqual({ error: 'That upload path is not one we issued.', status: 400 })
    expect(download).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })
})

// S0 content safety: every purpose has a format allow-list, enforced on the
// stored bytes. The lists are written out here, not read back from
// UPLOAD_PURPOSES, so widening one is a deliberate, reviewed change.
const DOCUMENTS: FileFormat[] = ['pdf', 'ole2', 'ooxml', 'odf', 'iwork']
const IMAGES: FileFormat[] = ['png', 'jpeg', 'gif', 'webp']
const SHARED: FileFormat[] = [
  ...DOCUMENTS, 'zip', 'rar', '7z', ...IMAGES, 'bmp', 'tiff', 'heif', 'psd', 'dwg', 'stl', 'skp', 'text', 'calendar',
  'mp4', 'webm', 'avi', 'asf', 'mp3', 'aac', 'wav', 'ogg', 'flac',
]
const LICENSE: FileFormat[] = ['png', 'jpeg', 'webp', 'heif', 'pdf']
const EXPECTED_FORMATS: Record<UploadPurpose, FileFormat[]> = {
  'admin-resource': SHARED,
  'space-resource': SHARED,
  'training-item': [...DOCUMENTS, ...IMAGES, 'mp4', 'webm'],
  'training-item-resource': SHARED,
  'training-cert-template': ['pdf'],
  'event-artwork': ['png', 'jpeg'],
  'artwork-default': ['png', 'jpeg'],
  'pd-certificate-artwork': ['png', 'jpeg'],
  'event-email-attachment': [...DOCUMENTS, ...IMAGES, 'heif', 'text', 'calendar'],
  'campaign-proposal': DOCUMENTS,
  'community-media': IMAGES,
  'space-attachment': SHARED,
  'container-contribution': SHARED,
  'compliance-document': LICENSE,
  'compliance-document-admin': LICENSE,
}

// Each purpose, against a sample of every format there is.
describe('claimUpload — each purpose’s allow-list', () => {
  it('has an allow-list for every purpose, matching the one above', () => {
    expect([...PURPOSES].sort()).toEqual(Object.keys(EXPECTED_FORMATS).sort())
    for (const p of PURPOSES) expect([...UPLOAD_PURPOSES[p].formats].sort()).toEqual([...EXPECTED_FORMATS[p]].sort())
  })

  const cases = PURPOSES.flatMap((purpose) => ALL_FORMATS.map((format) => [purpose, format] as const))

  it.each(cases)('%s × %s', async (purpose, format) => {
    const spec = UPLOAD_PURPOSES[purpose]
    const path = `p/1-${SAMPLE_NAMES[format]}`
    stored(FORMAT_SAMPLES[format])
    const result = await claimUpload({ purpose, storagePath: path })
    if (EXPECTED_FORMATS[purpose].includes(format)) {
      expect(result).toEqual({ bytes: FORMAT_SAMPLES[format], bucket: spec.bucket, format })
      expect(remove).not.toHaveBeenCalled()
    } else {
      expect(result).toEqual({ error: spec.formatError ?? DEFAULT_FORMAT_ERROR, status: 415 })
      expect(remove).toHaveBeenCalledWith([path])
    }
  })

  it('gives every purpose a non-empty list, and none takes a plain archive as a document', () => {
    for (const purpose of PURPOSES) expect(UPLOAD_PURPOSES[purpose].formats.length).toBeGreaterThan(0)
    expect(UPLOAD_PURPOSES['campaign-proposal'].formats).not.toContain('zip')
    expect(UPLOAD_PURPOSES['event-email-attachment'].formats).not.toContain('zip')
  })
})

describe('claimUpload — hostile files, whatever they are called', () => {
  const cases = PURPOSES.flatMap((purpose) =>
    Object.keys(HOSTILE_SAMPLES).flatMap((name) => ['x.pdf', 'x.png'].map((file) => [purpose, name, file] as const)),
  )

  it.each(cases)('%s refuses %s named %s', async (purpose, name, file) => {
    stored(HOSTILE_SAMPLES[name], file.endsWith('.pdf') ? 'application/pdf' : 'image/png')
    const result = await claimUpload({ purpose, storagePath: `p/1-${file}` })
    expect(result).toMatchObject({ status: 415 })
    expect(remove).toHaveBeenCalledWith([`p/1-${file}`])
  })
})

describe('claimUpload — spoofed extension', () => {
  const claim = async (purpose: UploadPurpose, bytes: Uint8Array, storagePath: string) => {
    stored(bytes)
    return claimUpload({ purpose, storagePath })
  }

  // The campaign proposal is a member upload that judges open, and was one of
  // the purposes that never checked its bytes before S0.
  it('refuses an HTML page named proposal.pdf and declared a PDF', async () => {
    getCurrentMemberMock.mockResolvedValue({ id: 'member-1' })
    getRegistrationMock.mockResolvedValue({ id: 'r1' })
    // Signing sees only the name and declared type, both the uploader's choice…
    const signed = await signUpload({
      purpose: 'campaign-proposal', ctx: { slug: 'mars' }, fileName: 'proposal.pdf', fileSize: 100, contentType: 'application/pdf',
    })
    expect(signed).toMatchObject({ token: 't' })
    // …so the stored bytes decide.
    const storagePath = createSignedUploadUrl.mock.calls[0][0] as string
    stored(HOSTILE_SAMPLES['an HTML page'], 'application/pdf')
    expect(await claimUpload({ purpose: 'campaign-proposal', storagePath })).toEqual({
      error: UPLOAD_PURPOSES['campaign-proposal'].formatError,
      status: 415,
    })
    expect(remove).toHaveBeenCalledWith([storagePath])
  })

  it.each([
    ['a PNG named proposal.pdf', 'campaign-proposal', 'png', 'proposal.pdf'],
    ['a PNG named proposal.docx', 'campaign-proposal', 'png', 'proposal.docx'],
    ['a RAR archive named deck.pptx', 'campaign-proposal', 'rar', 'deck.pptx'],
    ['a PDF named badge.png', 'event-artwork', 'pdf', 'badge.png'],
    ['a GIF named certificate.jpg', 'artwork-default', 'gif', 'certificate.jpg'],
    ['a WebP named front.png', 'pd-certificate-artwork', 'webp', 'front.png'],
    ['a zip named licence.pdf', 'compliance-document', 'zip', 'licence.pdf'],
    ['a video named schedule.pdf', 'event-email-attachment', 'mp4', 'schedule.pdf'],
    ['a text file named template.pdf', 'training-cert-template', 'text', 'template.pdf'],
  ] as const)('refuses %s', async (_name, purpose, format, file) => {
    const result = await claim(purpose, FORMAT_SAMPLES[format], `p/1-${file}`)
    expect(result).toEqual({ error: UPLOAD_PURPOSES[purpose].formatError ?? DEFAULT_FORMAT_ERROR, status: 415 })
    expect(remove).toHaveBeenCalledWith([`p/1-${file}`])
  })

  it('refuses a document whose name says it is another kind', async () => {
    const result = await claim('campaign-proposal', FORMAT_SAMPLES.ooxml, 'c/r/1-proposal.pdf')
    expect(result).toEqual({ error: 'That file’s contents don’t match its .pdf name.', status: 415 })
    expect(remove).toHaveBeenCalledWith(['c/r/1-proposal.pdf'])
  })

  it('refuses a plain zip, an installer and a macro document as a proposal', async () => {
    expect(await claim('campaign-proposal', FORMAT_SAMPLES.zip, 'c/r/1-proposal.docx')).toMatchObject({ status: 415 })
    expect(await claim('campaign-proposal', HOSTILE_SAMPLES['a Windows Installer package'], 'c/r/1-proposal.doc')).toMatchObject({ status: 415 })
    const docm = zipOf([{ name: '[Content_Types].xml', data: '<Types/>' }, { name: 'word/vbaProject.bin' }])
    expect(await claim('campaign-proposal', docm, 'c/r/1-proposal.docx')).toMatchObject({ status: 415 })
  })

  // A 97–2003 .doc or .xls carries macros inside the Compound File, not in its
  // name: judges open proposals, and every registrant receives an email's files.
  it.each([
    ['campaign-proposal', 'a Word document with a VBA project', 'c/r/1-proposal.doc'],
    ['event-email-attachment', 'an Excel workbook with a VBA project', 'event-email/nevada/1-rules.xls'],
    ['event-email-attachment', 'an Excel 4.0 macro sheet', 'event-email/nevada/1-budget.xls'],
    ['space-attachment', 'a PowerPoint presentation with a VBA project', 'community-resources/s/members/m/1-deck.ppt'],
  ] as const)('%s refuses %s', async (purpose, sample, path) => {
    expect(await claim(purpose, HOSTILE_SAMPLES[sample], path)).toMatchObject({ status: 415 })
    expect(remove).toHaveBeenCalledWith([path])
  })

  it('refuses a real file kept under a page or script name', async () => {
    const result = await claim('event-email-attachment', FORMAT_SAMPLES.pdf, 'event-email/nevada/1-schedule.html')
    expect(result).toMatchObject({ status: 415, error: expect.stringContaining('.html files can’t be uploaded') })
    expect(await claim('admin-resource', FORMAT_SAMPLES.text, 'resources/1-sketch.js')).toMatchObject({ status: 415 })
    expect(await claim('space-attachment', FORMAT_SAMPLES.pdf, 'community-resources/s/1-notes.svg')).toMatchObject({ status: 415 })
    // Windows saves `notes.html.` as notes.html: a trailing dot hides nothing.
    expect(await claim('admin-resource', FORMAT_SAMPLES.pdf, 'resources/1-notes.html.')).toMatchObject({ status: 415 })
  })

  it('lets a shared file carry a listed program’s name, but not another format’s', async () => {
    expect(await claim('admin-resource', FORMAT_SAMPLES.zip, 'resources/1-geometry.ggb')).toMatchObject({ format: 'zip' })
    expect(await claim('admin-resource', FORMAT_SAMPLES.text, 'resources/1-lesson.ipynb')).toMatchObject({ format: 'text' })
    expect(await claim('space-attachment', threeMf(), 'community-resources/s/members/m/1-bracket.3mf')).toMatchObject({ format: 'ooxml' })
    expect(await claim('admin-resource', FORMAT_SAMPLES.pdf, 'resources/1-notes.txt')).toEqual({
      error: 'That file’s contents don’t match its .txt name.', status: 415,
    })
  })

  // Shared-file names are an allow-list: an extension nobody listed may still
  // install or run when a member (children included) downloads and opens it.
  it.each([
    ['space-attachment', 'an app package', 'homework-helper.msix', zipOf([{ name: '[Content_Types].xml', data: '<Types/>' }, { name: 'AppxManifest.xml' }])],
    ['container-contribution', 'an app package', 'game.appx', FORMAT_SAMPLES.zip],
    ['container-contribution', 'an editor extension', 'theme.vsix', FORMAT_SAMPLES.zip],
    ['space-attachment', 'a windowless Python script', 'game.pyw', bytes('import os\nos.system("calc")\n')],
    ['space-attachment', 'a remote desktop connection', 'lab.rdp', bytes('full address:s:203.0.113.9\r\ndrivestoredirect:s:*\r\n')],
    ['space-attachment', 'an internet shortcut', 'notes.website', bytes('[InternetShortcut]\r\nURL=https://example.org\r\n')],
    ['admin-resource', 'an unfamiliar name', 'lesson.foo', FORMAT_SAMPLES.zip],
    ['event-email-attachment', 'a Python script', 'schedule.py', bytes('print("hello")\n')],
  ] as const)('%s refuses %s named %s', async (purpose, _what, name, sample) => {
    const path = `p/1-${name}`
    expect(await claim(purpose, sample, path)).toMatchObject({ status: 415 })
    expect(remove).toHaveBeenCalledWith([path])
  })

  it('says an unlisted name isn’t accepted, rather than that the contents don’t match', async () => {
    expect(await claim('admin-resource', FORMAT_SAMPLES.zip, 'resources/1-lesson.foo')).toEqual({
      error: '.foo files aren’t accepted here.', status: 415,
    })
  })
})

// Storage serves an object under the type sent with the PUT, which need not be
// the type declared when signing. Real bytes, under a fitting name, stored as an
// active type are still a page.
describe('claimUpload — spoofed stored type', () => {
  it.each([
    ['admin-resource', 'pdf', 'text/html'],
    ['campaign-proposal', 'pdf', 'text/html'],
    ['community-media', 'png', 'image/svg+xml'],
    ['event-email-attachment', 'text', 'text/html; charset=utf-8'],
    ['space-attachment', 'pdf', 'application/xhtml+xml'],
    ['compliance-document', 'jpeg', 'text/xml'],
    ['event-artwork', 'png', 'application/javascript'],
  ] as const)('%s refuses real %s bytes stored as %s', async (purpose, format, type) => {
    const storagePath = `p/1-${SAMPLE_NAMES[format]}`
    stored(FORMAT_SAMPLES[format], type)
    expect(await claimUpload({ purpose, storagePath })).toEqual({ error: 'That file type is not accepted here.', status: 415 })
    expect(remove).toHaveBeenCalledWith([storagePath])
  })
})

// The uploads the live Nevada event (6 Nov) depends on — teaching licences,
// badge and certificate artwork, the reminder emails' attachments — plus
// campaign proposals and post images. Each is signed with the name and type a
// browser really sends, then claimed from the path signing issued, so the name
// rules at both steps are exercised, not just the byte check.
describe('legitimate uploads still go through, signed then claimed', () => {
  const MEMBER = '3f2b8c1e-5d4a-4b6f-9e2d-7a1c0b9d8e6f'
  const ICS = bytes('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:Nevada Space Settlement Design\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n')
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

  const asMember = () => getCurrentMemberMock.mockResolvedValue({ id: MEMBER })
  const asEventManager = () =>
    requireEventAccessMock.mockResolvedValue({ ok: true, userId: 'u1', isAdmin: false, assignedSlugs: ['nevada'] })

  async function upload(
    purpose: UploadPurpose, ctx: Record<string, string>, fileName: string, contentType: string, sample: Uint8Array,
  ) {
    expect(await signUpload({ purpose, ctx, fileName, fileSize: sample.byteLength, contentType })).toMatchObject({ token: 't' })
    const storagePath = createSignedUploadUrl.mock.calls.at(-1)?.[0] as string
    stored(sample, contentType)
    const result = await claimUpload({ purpose, storagePath })
    expect(remove).not.toHaveBeenCalled()
    return result
  }

  it.each([
    ['licence.HEIC', 'image/heic', 'heif'],
    ['IMG_0002.HEIC', 'image/heic', 'jpeg'], // a JPEG under an iPhone's name
    ['licence.jpg', 'image/jpeg', 'jpeg'],
    ['licence scan.pdf', 'application/pdf', 'pdf'],
    ['licence.webp', 'image/webp', 'webp'],
    ['scan.png', 'image/png', 'png'],
  ] as const)('a teacher licence, self-uploaded and by an admin: %s', async (fileName, type, format) => {
    asMember()
    licenseRow.current = { id: 'l1' }
    expect(await upload('compliance-document', {}, fileName, type, FORMAT_SAMPLES[format])).toMatchObject({
      bucket: 'teacher-licenses', format,
    })

    vi.clearAllMocks()
    asAdmin()
    expect(await upload('compliance-document-admin', { memberId: MEMBER }, fileName, type, FORMAT_SAMPLES[format])).toMatchObject({
      bucket: 'teacher-licenses', format,
    })
  })

  it.each([
    ['event-artwork', { slug: 'nevada', kind: 'badge' }, 'Nevada badge.png', 'image/png', 'png'],
    ['event-artwork', { slug: 'nevada', kind: 'badge8395' }, 'name badge.jpg', 'image/jpeg', 'jpeg'],
    ['event-artwork', { slug: 'nevada', kind: 'badge' }, 'saved-as.png', 'image/png', 'jpeg'], // a JPEG saved as .png
    ['event-artwork', { slug: 'nevada', kind: 'certificate-participation' }, 'participation.png', 'image/png', 'png'],
    ['event-artwork', { slug: 'nevada', kind: 'certificate-norm_chaffee' }, 'finalist.jpg', 'image/jpeg', 'jpeg'],
    ['artwork-default', { theme: 'environmental', kind: 'certificate-mentor' }, 'mentor.png', 'image/png', 'png'],
    ['pd-certificate-artwork', {}, 'PD front.jpeg', 'image/jpeg', 'jpeg'],
    ['pd-certificate-artwork', {}, 'PD back.png', 'image/png', 'png'],
  ] as const)('badge and certificate artwork: %s %j %s', async (purpose, ctx, fileName, type, format) => {
    asAdmin()
    asEventManager()
    expect(await upload(purpose, ctx, fileName, type, FORMAT_SAMPLES[format])).toMatchObject({
      bucket: 'community-resources', format,
    })
  })

  it.each([
    ['Nevada schedule.pdf', 'application/pdf', FORMAT_SAMPLES.pdf, 'pdf'],
    ['Mentor volunteer agreement.pdf', 'application/pdf', FORMAT_SAMPLES.pdf, 'pdf'],
    ['Parent letter.docx', DOCX, FORMAT_SAMPLES.ooxml, 'ooxml'],
    ['Roster.xlsx', XLSX, FORMAT_SAMPLES.ooxml, 'ooxml'],
    ['Budget.xls', 'application/vnd.ms-excel', FORMAT_SAMPLES.ole2, 'ole2'],
    ['Rules.doc', 'application/msword', FORMAT_SAMPLES.ole2, 'ole2'],
    ['Venue map.png', 'image/png', FORMAT_SAMPLES.png, 'png'],
    ['Team photo.HEIC', 'image/heic', FORMAT_SAMPLES.heif, 'heif'],
    ['Teams.csv', 'text/csv', FORMAT_SAMPLES.text, 'text'],
    ['Check-in.ics', 'text/calendar', ICS, 'calendar'],
    ['Check-in (Outlook).ics', 'text/calendar', OUTLOOK_ICS, 'calendar'],
    ['Parent letter (protected).docx', DOCX, encryptedOoxml(), 'ooxml'],
    ['Budget 2026.xls', 'application/vnd.ms-excel', compoundFile(EXCEL_CLSID, [{ name: 'Workbook', data: workbookStream(0, 6000) }]), 'ole2'],
    ['Rules 2026.doc', 'application/msword', compoundFile(WORD_CLSID, [{ name: 'WordDocument', data: Buffer.alloc(4096) }]), 'ole2'],
    // Longer than the 120 characters a stored name keeps, with a dot early on.
    [`Nevada SSDC 2026 v1.2 - Parent and Guardian Information Packet including schedule, venue map, check-in steps, parking and the full FAQ.pdf`, 'application/pdf', FORMAT_SAMPLES.pdf, 'pdf'],
  ] as const)('an event email attachment: %s', async (fileName, type, sample, format) => {
    asEventManager()
    expect(await upload('event-email-attachment', { slug: 'nevada' }, fileName, type, sample)).toMatchObject({
      bucket: 'community-resources', format,
    })
  })

  it('a course certificate template', async () => {
    asAdmin()
    expect(await upload('training-cert-template', { moduleId: 'm1' }, 'Certificate.pdf', 'application/pdf', FORMAT_SAMPLES.pdf)).toMatchObject({
      bucket: 'community-resources', format: 'pdf',
    })
  })

  it.each([
    ['Proposal.pdf', 'application/pdf', 'pdf'],
    ['Proposal.docx', DOCX, 'ooxml'],
    ['Proposal.pptx', PPTX, 'ooxml'],
    ['Proposal.ppt', 'application/vnd.ms-powerpoint', 'ole2'],
    ['Proposal.key', '', 'iwork'],
    ['Proposal.odt', 'application/vnd.oasis.opendocument.text', 'odf'],
    [`Team Orbiters Space Settlement Proposal v2.3 - St. Mary's Academy, Las Vegas, Nevada - submitted for judging on Nov. 6 - FINAL.pdf`, 'application/pdf', 'pdf'],
  ] as const)('a campaign proposal: %s', async (fileName, type, format) => {
    asMember()
    getRegistrationMock.mockResolvedValue({ id: 'r1' })
    expect(await upload('campaign-proposal', { slug: 'mars' }, fileName, type, FORMAT_SAMPLES[format])).toMatchObject({
      bucket: 'campaign-proposals', format,
    })
  })

  it.each([
    ['photo.png', 'image/png', 'png'],
    ['photo.jpg', 'image/jpeg', 'jpeg'],
  ] as const)('an image embedded in a post: %s', async (fileName, type, format) => {
    asMember()
    expect(await upload('community-media', {}, fileName, type, FORMAT_SAMPLES[format])).toMatchObject({
      bucket: 'community-resources', format,
    })
  })
})

describe('signUpload — names', () => {
  const sign = (purpose: UploadPurpose, fileName: string, contentType = 'application/octet-stream') =>
    signUpload({ purpose, ctx: {}, fileName, fileSize: 10, contentType })

  // A name or a declared type a browser or desktop would run, whatever the bytes
  // turn out to be — refused for a purpose that otherwise takes any extension.
  it.each([
    ['page.html', 'application/pdf'],
    ['notes.html', 'text/plain'],
    ['diagram.svg', 'image/svg+xml'],
    ['readme.txt', 'text/html'],
    ['map.pdf', 'application/xhtml+xml'],
    ['sketch.js', 'application/pdf'],
    ['tool.jar', 'application/java-archive'],
    ['setup.exe', 'application/octet-stream'],
    ['macro.xlsm', 'application/pdf'],
    ['report.pdf.html', 'application/pdf'],
    ['trailing.html.', 'application/pdf'],
    ['spaced.html ', 'application/pdf'],
    ['homework-helper.msix', 'application/octet-stream'],
    ['game.pyw', 'text/plain'],
    ['lab.rdp', 'application/x-rdp'],
    ['lesson.foo', 'application/octet-stream'],
  ])('refuses to sign %j declared %s', async (fileName, contentType) => {
    asAdmin()
    expect(await sign('admin-resource', fileName, contentType)).toMatchObject({ status: 415 })
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('refuses, before signing, a name a strict purpose never takes', async () => {
    getCurrentMemberMock.mockResolvedValue({ id: 'member-1' })
    getRegistrationMock.mockResolvedValue({ id: 'reg-1' })
    requireEventAccessMock.mockResolvedValue({ ok: true, userId: 'u1', isAdmin: false, assignedSlugs: ['nevada'] })
    const signFor = (purpose: UploadPurpose, slug: string, fileName: string, contentType: string) =>
      signUpload({ purpose, ctx: { slug }, fileName, fileSize: 10, contentType })
    expect(await signFor('campaign-proposal', 'mars', 'files.zip', 'application/zip')).toMatchObject({ status: 415 })
    expect(await signFor('event-email-attachment', 'nevada', 'clip.mp4', 'video/mp4')).toMatchObject({ status: 415 })
    expect(await signFor('event-email-attachment', 'nevada', 'schedule.py', 'text/x-python')).toMatchObject({ status: 415 })
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  // Every grant only reads, so it runs first: a caller it refuses never gets as
  // far as the name checks, and learns nothing from them.
  it('answers a caller the grant refuses before reading the name', async () => {
    asVisitor()
    getCurrentMemberMock.mockResolvedValue(null)
    requireEventAccessMock.mockResolvedValue({ ok: false, status: 401 })
    expect(await sign('admin-resource', 'page.html', 'application/pdf')).toEqual({ error: 'Forbidden', status: 403 })
    expect(await sign('community-media', 'setup.exe', 'image/png')).toEqual({ error: 'Unauthorised', status: 401 })
    expect(
      await signUpload({ purpose: 'event-email-attachment', ctx: { slug: 'nevada' }, fileName: 'notes.html', fileSize: 10, contentType: 'text/plain' }),
    ).toEqual({ error: 'Forbidden', status: 401 })
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  // POST /api/uploads/sign caps the name too; this holds for any other caller.
  it('refuses a name over 255 characters before anything else', async () => {
    asAdmin()
    expect(await sign('admin-resource', `${'a'.repeat(252)}.pdf`, 'application/pdf')).toEqual({
      error: FILE_NAME_TOO_LONG, status: 400,
    })
    expect(await sign('admin-resource', `${'a'.repeat(251)}.pdf`, 'application/pdf')).toEqual({
      bucket: 'community-resources', path: 'p', token: 't',
    })
    asVisitor()
    for (const run of [' ', '.']) {
      const started = performance.now()
      expect(await sign('admin-resource', `a${run.repeat(1024 * 1024)}x`)).toMatchObject({ status: 400 })
      expect(performance.now() - started).toBeLessThan(500)
    }
    expect(createSignedUploadUrl).toHaveBeenCalledTimes(1)
  })

  it.each(['geometry.ggb', 'lesson.ipynb', 'bracket.3mf', 'chassis.sldprt'])('signs a shared file named %s', async (fileName) => {
    asAdmin()
    expect(await sign('admin-resource', fileName)).toEqual({ bucket: 'community-resources', path: 'p', token: 't' })
  })

  // The media proxy serves community-media/…; an image is signed elsewhere and
  // only republished there once claimed (app/api/community/media/upload).
  it('signs an embedded image into the staging prefix, never the served one', async () => {
    getCurrentMemberMock.mockResolvedValue({ id: 'member-1' })
    expect(await sign('community-media', 'a.png', 'image/png')).toEqual({ bucket: 'community-resources', path: 'p', token: 't' })
    expect(createSignedUploadUrl.mock.calls[0][0]).toMatch(/^community-media-staging\/member-1\/\d+-a\.png$/)
  })
})

// Whether to take .rtf, .msg and .xlsb is still to be decided, so no purpose
// lists them. Until then each refusal says the file type isn't accepted:
// signing used to tell an event manager that an Excel workbook (.xlsb)
// "doesn't look like a PDF, Office, … file".
describe('.rtf, .msg and .xlsb, until someone decides to take them', () => {
  const OUTLOOK_CLSID = [0x0b, 0x0d, 0x02, 0x00, 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46]
  const PENDING = {
    rtf: { type: 'application/rtf', format: 'text', sample: bytes('{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Times;}} Hello}\n') },
    msg: {
      type: 'application/vnd.ms-outlook',
      format: 'ole2',
      sample: compoundFile(OUTLOOK_CLSID, [{ name: '__substg1.0_0037001F', data: Buffer.alloc(64) }]),
    },
    xlsb: {
      type: 'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
      format: 'ooxml',
      sample: zipOf([{ name: '[Content_Types].xml', data: '<Types/>' }, { name: 'xl/workbook.bin' }]),
    },
  } as const
  const EXTS = Object.keys(PENDING) as (keyof typeof PENDING)[]
  const CTX = { slug: 'nevada', kind: 'badge', theme: 'environmental', moduleId: 'm1', memberId: 'm1', spaceId: 's1', spaceSlug: 'rovers', containerId: 'c1' }
  const grantEverything = () => {
    asAdmin()
    getCurrentMemberMock.mockResolvedValue({ id: 'm1', isAdmin: false })
    getRegistrationMock.mockResolvedValue({ id: 'r1' })
    requireEventAccessMock.mockResolvedValue({ ok: true, userId: 'u1', isAdmin: true, assignedSlugs: null })
    memberManagesContainerMock.mockResolvedValue(true)
    getSpaceForMemberMock.mockResolvedValue({ id: 's1', access: { canAccess: true }, allowMemberUploads: true })
    licenseRow.current = { id: 'l1' }
  }

  it('sniffs each as a format some purpose takes, so the name is what refuses it', () => {
    for (const ext of EXTS) expect(sniffFileFormat(PENDING[ext].sample)).toBe(PENDING[ext].format)
  })

  it.each(PURPOSES.flatMap((purpose) => EXTS.map((ext) => [purpose, ext] as const)))(
    '%s won’t sign Budget.%s, and says the type isn’t accepted',
    async (purpose, ext) => {
      grantEverything()
      const signed = await signUpload({ purpose, ctx: CTX, fileName: `Budget.${ext}`, fileSize: 10, contentType: PENDING[ext].type })
      // A purpose with a list of types refuses the declared type first.
      const error = UPLOAD_PURPOSES[purpose].allowedTypes ? 'That file type is not accepted here.' : `.${ext} files aren’t accepted here.`
      expect(signed).toEqual({ error, status: 415 })
      expect(createSignedUploadUrl).not.toHaveBeenCalled()
    },
  )

  it.each(
    PURPOSES.flatMap((purpose) =>
      EXTS.filter((ext) => UPLOAD_PURPOSES[purpose].formats.includes(PENDING[ext].format)).map((ext) => [purpose, ext] as const),
    ),
  )('%s, handed Budget.%s anyway, says the same once it has read the bytes', async (purpose, ext) => {
    stored(PENDING[ext].sample)
    const storagePath = `p/1-Budget.${ext}`
    expect(await claimUpload({ purpose, storagePath })).toEqual({ error: `.${ext} files aren’t accepted here.`, status: 415 })
    expect(remove).toHaveBeenCalledWith([storagePath])
  })
})

describe('isUploadPurpose', () => {
  it('takes every purpose there is', () => {
    for (const purpose of Object.keys(UPLOAD_PURPOSES)) expect(isUploadPurpose(purpose)).toBe(true)
  })

  // `in` found these on Object.prototype, and signing under one threw.
  it.each(['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf', 'isPrototypeOf'])('refuses %j', (name) => {
    expect(isUploadPurpose(name)).toBe(false)
  })

  it('refuses anything that is not a string', () => {
    for (const value of [undefined, null, 42, {}, ['admin-resource']]) expect(isUploadPurpose(value)).toBe(false)
  })
})

describe('safeFileName', () => {
  it('strips path separators and traversal', () => {
    expect(safeFileName('../../etc/passwd')).toBe('._._etc_passwd')
  })
  // claimUpload refuses a path holding `..`, so a stored name never has one.
  it('turns a run of dots into one', () => {
    expect(safeFileName('Final..pdf')).toBe('Final.pdf')
    expect(safeFileName('notes...v2.txt')).toBe('notes.v2.txt')
  })
  it('never returns an empty name', () => {
    expect(safeFileName('///')).toBe('___')
  })
  // Cutting the end off used to leave `… v1.2 … packet inclu` — an extension of
  // `2_-_parent…`, which a strict purpose refused as "not a PDF".
  it('shortens a long name from the stem, keeping its extension', () => {
    const name = `Nevada SSDC 2026 v1.2 - ${'Parent and Guardian Information Packet '.repeat(4)}.pdf`
    const safe = safeFileName(name)
    expect(safe).toHaveLength(120)
    expect(safe.endsWith('.pdf')).toBe(true)
    expect(safe.startsWith('Nevada_SSDC_2026_v1.2_-_Parent')).toBe(true)
    expect(safeFileName(`${'x'.repeat(115)}.html.pdf`)).toBe(`${'x'.repeat(115)}.pdf`)
    // A cut that ends on a dot doesn't leave `..` in front of the extension.
    expect(safeFileName(`${'a'.repeat(115)}. b c.pdf`)).toBe(`${'a'.repeat(115)}.pdf`)
  })
})

// A member's own uploads sit in a folder of their own. Admin files share the
// rest of the space and catalogue namespaces, and a refused claim deletes the
// object it was pointed at — so a claim pinned to the shared prefix would let a
// member delete an admin's file by posting its path back.
describe('member upload folders', () => {
  const MEMBER = '3f2b8c1e-5d4a-4b6f-9e2d-7a1c0b9d8e6f'
  const SPACE = 'a1b2c3d4-0000-4000-8000-000000000001'

  it('signs a space attachment into the member’s folder in that space', async () => {
    getCurrentMemberMock.mockResolvedValue({ id: MEMBER, isAdmin: false })
    getSpaceForMemberMock.mockResolvedValue({ id: SPACE, access: { canAccess: true }, allowMemberUploads: true })
    await signUpload({ purpose: 'space-attachment', ctx: { spaceSlug: 'rovers' }, fileName: 'notes.pdf', fileSize: 10, contentType: 'application/pdf' })
    const path = createSignedUploadUrl.mock.calls[0][0] as string
    expect(path.startsWith(spaceAttachmentPrefix(SPACE, MEMBER))).toBe(true)
    expect(spaceAttachmentPrefix(SPACE, MEMBER)).toBe(`community-resources/${SPACE}/members/${MEMBER}/`)
  })

  it('signs a container contribution into the member’s folder', async () => {
    getCurrentMemberMock.mockResolvedValue({ id: MEMBER, isAdmin: false })
    memberManagesContainerMock.mockResolvedValue(true)
    await signUpload({ purpose: 'container-contribution', ctx: { containerId: 'c1' }, fileName: 'notes.pdf', fileSize: 10, contentType: 'application/pdf' })
    const path = createSignedUploadUrl.mock.calls[0][0] as string
    expect(path.startsWith(contributionPrefix(MEMBER))).toBe(true)
    expect(contributionPrefix(MEMBER)).toBe(`resources/members/${MEMBER}/`)
  })

  it('keeps every member folder clear of the paths admin uploads get', async () => {
    asAdmin()
    await signUpload({ purpose: 'space-resource', ctx: { spaceId: SPACE }, fileName: 'members', fileSize: 10, contentType: '' })
    await signUpload({ purpose: 'admin-resource', ctx: {}, fileName: 'members', fileSize: 10, contentType: '' })
    const [spacePath, catalogPath] = createSignedUploadUrl.mock.calls.map((c) => c[0] as string)
    expect(spacePath.startsWith(`community-resources/${SPACE}/members/`)).toBe(false)
    expect(catalogPath.startsWith('resources/members/')).toBe(false)
  })
})

// A member's PDF is capped at 50 pages (owner decision, 3 Nov 2026), counted
// before the watermark's pdf-lib opens it. Admin-only purposes keep no cap.
const { PDFDocument } = await import('pdf-lib')
const { deflateSync } = await import('node:zlib')
const { MAX_MEMBER_PDF_PAGES, PDF_TOO_MANY_PAGES, PDF_PAGES_UNKNOWN } = await import('./pdf-page-count')

describe('claimUpload — PDF page cap', () => {
  const pdfOf = async (pages: number) => {
    const doc = await PDFDocument.create()
    for (let i = 0; i < pages; i++) doc.addPage([612, 792])
    return doc.save()
  }
  // 300,000 pages in one compressed object stream: a few MB on disk.
  const crafted = () => {
    const objects = ['<< /Type /Pages >>', ...Array.from({ length: 300_000 }, () => '<< /Type /Page /Parent 3 0 R >>')]
    const offsets: number[] = []
    let body = ''
    for (const o of objects) {
      offsets.push(body.length)
      body += `${o}\n`
    }
    const header = offsets.map((off, i) => `${i + 3} ${off}`).join(' ')
    const data = deflateSync(Buffer.from(`${header}\n${body}`, 'latin1'))
    return Buffer.concat([
      Buffer.from(`%PDF-1.7\n2 0 obj\n<< /Type /ObjStm /First ${header.length + 1} /Filter /FlateDecode >>\nstream\n`),
      data,
      Buffer.from('\nendstream\nendobj\n%%EOF\n'),
    ])
  }

  // Every purpose a member (or an event manager) reaches that takes a PDF.
  const MEMBER_PDF: [UploadPurpose, string, string?][] = [
    ['campaign-proposal', 'nevada/r1/1-proposal.pdf'],
    ['space-attachment', `${spaceAttachmentPrefix('s1', 'm1')}1-notes.pdf`, spaceAttachmentPrefix('s1', 'm1')],
    ['container-contribution', `${contributionPrefix('m1')}1-notes.pdf`, contributionPrefix('m1')],
    ['compliance-document', 'm1/1-licence.pdf'],
    ['event-email-attachment', 'event-email/nevada/1-schedule.pdf'],
  ]

  it('caps every member purpose that takes a PDF, and no admin-only one', () => {
    const capped = PURPOSES.filter((p) => UPLOAD_PURPOSES[p].maxPdfPages !== undefined).sort()
    expect(capped).toEqual(MEMBER_PDF.map(([p]) => p).sort())
    for (const p of capped) expect(UPLOAD_PURPOSES[p].maxPdfPages).toBe(MAX_MEMBER_PDF_PAGES)
  })

  it.each(MEMBER_PDF)('%s takes 50 pages and refuses 51', async (purpose, storagePath, expectedPrefix) => {
    stored(await pdfOf(50), 'application/pdf')
    expect(await claimUpload({ purpose, storagePath, expectedPrefix })).toMatchObject({ format: 'pdf' })
    expect(remove).not.toHaveBeenCalled()

    stored(await pdfOf(51), 'application/pdf')
    expect(await claimUpload({ purpose, storagePath, expectedPrefix })).toEqual({ error: PDF_TOO_MANY_PAGES, status: 413 })
    expect(remove).toHaveBeenCalledWith([storagePath])
  })

  it('refuses the 300,000-page file quickly, and deletes it', async () => {
    stored(crafted(), 'application/pdf')
    const started = performance.now()
    const result = await claimUpload({ purpose: 'campaign-proposal', storagePath: 'nevada/r1/1-proposal.pdf' })
    expect(performance.now() - started).toBeLessThan(1000)
    expect([PDF_TOO_MANY_PAGES, PDF_PAGES_UNKNOWN]).toContain((result as { error: string }).error)
    expect(remove).toHaveBeenCalledWith(['nevada/r1/1-proposal.pdf'])
  })

  it('refuses a PDF whose pages it can’t count', async () => {
    stored(
      Buffer.from('%PDF-1.7\n2 0 obj\n<< /Type /ObjStm /Filter /LZWDecode >>\nstream\nxx\nendstream\nendobj\n%%EOF\n'),
      'application/pdf',
    )
    expect(await claimUpload({ purpose: 'compliance-document', storagePath: 'm1/1-licence.pdf' })).toEqual({
      error: PDF_PAGES_UNKNOWN,
      status: 415,
    })
  })

  it('leaves admin-only purposes at their own limits', async () => {
    stored(await pdfOf(51), 'application/pdf')
    expect(await claimUpload({ purpose: 'admin-resource', storagePath: 'resources/1-a.pdf' })).toMatchObject({ format: 'pdf' })
    stored(await pdfOf(51), 'application/pdf')
    expect(
      await claimUpload({ purpose: 'compliance-document-admin', storagePath: 'm1/1-licence.pdf' }),
    ).toMatchObject({ format: 'pdf' })
  })

  it('counts nothing for a file that isn’t a PDF', async () => {
    stored(FORMAT_SAMPLES.png, 'image/png')
    expect(await claimUpload({ purpose: 'compliance-document', storagePath: 'm1/1-licence.png' })).toMatchObject({
      format: 'png',
    })
  })
})
