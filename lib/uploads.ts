import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { RESOURCES_BUCKET, getCurrentMember, type CommunityMember } from '@/lib/community'
import { assertNotImpersonating } from '@/lib/impersonation'
import { getSpaceForMember } from '@/lib/spaces'
import { getMemberCampaignRegistration } from '@/lib/campaign-registrations'
import { memberManagesContainer } from '@/lib/resource-upload'
import { requireEventAccess } from '@/lib/event-access'
import { AWARD_TYPES } from '@/lib/event-awards'
import { BADGE_FORMATS } from '@/lib/badge-layout'
import { isArtworkTheme } from '@/lib/artwork-theme'
import { LICENSE_DOCUMENT_TYPES, TEACHER_LICENSE_BUCKET } from '@/lib/teacher-license'
import { isLiteralStoragePath } from '@/lib/storage-path'
import {
  extensionsFor,
  fileExtension,
  isActiveContentType,
  isDangerousExtension,
  nameMatchesFormat,
  shortenFileName,
  sniffFileFormat,
  type FileFormat,
} from '@/lib/file-sniff'

// Every file upload in the app, in one place.
//
// Why this exists: Vercel rejects a request body over 4.5MB before the function
// runs, and nothing in config changes that. Uploads used to POST their bytes to
// a route handler, so every one of them was silently capped at 4.5MB — several
// while advertising 8, 10 or 25MB, and the training video path while accepting
// a format that is essentially never that small.
//
// So bytes no longer pass through a function. The browser asks
// /api/uploads/sign for a short-lived Supabase signed upload URL, PUTs the file
// straight to storage, and posts back only the path. The owning route then
// claims it with claimUpload(), which is where size, type and the actual stored
// bytes are verified — the browser's claims about its own file are never
// trusted, because between signing and claiming it could have sent anything.
// Every purpose names the formats it accepts (`formats`), and the stored bytes
// must sniff as one of them (lib/file-sniff.ts): an extension or a declared type
// proves nothing. The name must fit the bytes too — it decides what opens the
// file once someone downloads it — and a page, script or executable extension is
// never accepted.
//
// Two layers of authorisation, deliberately:
//   sign  — may this caller write bytes into this purpose's namespace at all?
//   claim — the owning route re-checks the specific object-level rule (does this
//           member manage that container, is that post in that space, …) before
//           anything is recorded. A signed URL alone never makes a file reachable:
//           the buckets are private and nothing is served without a row — or,
//           for embedded images, until the server has republished the verified
//           bytes (community-media signs into a staging prefix the media proxy
//           never serves).

const PROPOSALS_BUCKET = 'campaign-proposals'
const LICENSES_BUCKET = TEACHER_LICENSE_BUCKET

const MB = 1024 * 1024

export type UploadPurpose =
  | 'admin-resource'
  | 'space-resource'
  | 'training-item'
  | 'training-item-resource'
  | 'training-cert-template'
  | 'event-artwork'
  | 'artwork-default'
  | 'pd-certificate-artwork'
  | 'event-email-attachment'
  | 'campaign-proposal'
  | 'community-media'
  | 'space-attachment'
  | 'container-contribution'
  | 'compliance-document'
  | 'compliance-document-admin'

export type UploadContext = Record<string, string | undefined>

export type UploadDenied = { error: string; status: number }

/** A stored object claimUpload accepted: its bytes, its bucket and the format they sniff as. */
export type ClaimedUpload = { bytes: Uint8Array; bucket: string; format: FileFormat }
type Granted = { path: string }

type PurposeSpec = {
  bucket: string
  maxBytes: number
  /**
   * Exact allowlist for the type the browser DECLARES, checked when signing.
   * Undefined means any declared type except an active one (HTML, SVG, script).
   */
  allowedTypes?: readonly string[]
  /**
   * What the stored bytes must actually be, checked by claimUpload on every
   * claim. Required: there is no purpose that takes any file at all.
   */
  formats: readonly FileFormat[]
  /** Shown when the stored bytes are not one of `formats`. */
  formatError?: string
  /**
   * By default a file's extension must be one of its sniffed format's
   * (lib/file-sniff FORMAT_EXTENSIONS). The shared-file purposes also take the
   * names in SHARED_EXTENSIONS (a notebook `.ipynb`, a 3D print `.3mf`) — never
   * an extension nobody listed.
   */
  sharedFileNames?: boolean
  /**
   * Authorise the caller and decide where the object lands. Returning a path is
   * what grants the upload, so any check needed to *build* the path (resolving a
   * registration, a space, a member) doubles as the gate.
   */
  grant(args: {
    ctx: UploadContext
    safeName: string
    contentType: string
  }): Promise<Granted | UploadDenied>
}

function deny(error: string, status = 403): UploadDenied {
  return { error, status }
}

const MAX_NAME = 120

/**
 * The longest file name signUpload takes, as sent — the longest most file
 * systems allow. Anything longer is refused before it is read.
 */
export const MAX_FILE_NAME_LENGTH = 255
export const FILE_NAME_TOO_LONG = `That file name is too long. Shorten it to ${MAX_FILE_NAME_LENGTH} characters or fewer and try again.`

/**
 * Strip anything that could escape the intended prefix, and shorten to 120
 * characters from the end of the stem, keeping the extension (shortenFileName).
 * Runs of dots become one: claimUpload refuses any path holding `..`.
 */
export function safeFileName(name: string): string {
  const oneDot = (s: string) => s.replace(/\.{2,}/g, '.')
  return oneDot(shortenFileName(oneDot(name.replace(/[^a-zA-Z0-9._-]/g, '_')) || 'file', MAX_NAME))
}

/**
 * Where a member's own space attachments land. An admin's space files sit
 * directly under community-resources/<spaceId>/, so the member's id keeps the
 * two apart: a claim pinned here can only read — or, refusing it, delete — an
 * object this member was issued.
 */
export const spaceAttachmentPrefix = (spaceId: string, memberId: string) =>
  `community-resources/${spaceId}/members/${memberId}/`

/** Likewise for container contributions, beside the admin catalogue's resources/<time>-<name>. */
export const contributionPrefix = (memberId: string) => `resources/members/${memberId}/`

async function requireAdmin(): Promise<null | UploadDenied> {
  const { sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  return role === 'admin' ? null : deny('Forbidden')
}

/**
 * A member acting as themselves. Impersonation is a lens, not a login — an admin
 * viewing as someone must never upload as them.
 */
async function requireMember(): Promise<CommunityMember | UploadDenied> {
  if (await assertNotImpersonating()) {
    return deny('Read-only while viewing as a member. Exit view-as to make changes.')
  }
  const member = await getCurrentMember()
  return member ?? deny('Unauthorised', 401)
}

// One badge background per Avery format, or one certificate background per award.
const EVENT_ARTWORK_KINDS = [
  ...Object.values(BADGE_FORMATS).map((f) => f.artworkKind),
  ...AWARD_TYPES.map((t) => `certificate-${t}`),
]

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
const LICENSE_TYPES = LICENSE_DOCUMENT_TYPES

// Sniffed formats (lib/file-sniff.ts), by what a purpose is for.
const IMAGES: readonly FileFormat[] = ['png', 'jpeg', 'gif', 'webp']
/** What the certificate and badge renderers can draw. */
const ARTWORK: readonly FileFormat[] = ['png', 'jpeg']
/**
 * PDF, legacy Office (DOC/PPT/XLS), OOXML (DOCX/XLSX/PPTX, never macro-enabled),
 * OpenDocument and Keynote/Pages/Numbers. Not a plain archive, and never an
 * installer: those sniff as 'zip' or as nothing.
 */
const DOCUMENTS: readonly FileFormat[] = ['pdf', 'ole2', 'ooxml', 'odf', 'iwork']
const ARCHIVES: readonly FileFormat[] = ['zip', 'rar', '7z']
const VIDEO: readonly FileFormat[] = ['mp4', 'webm']
const LICENSE_FORMATS: readonly FileFormat[] = ['png', 'jpeg', 'webp', 'heif', 'pdf']
/**
 * Files shared in the Resources catalogue, a space or a lesson: documents,
 * spreadsheets and slides, archives, images (scans and Photoshop files too),
 * CAD (DWG, STL, SketchUp, and DXF/STEP as text), plain text and CSV, calendars,
 * video and audio. Never HTML, SVG or anything executable — none of those sniff
 * as any format, and their extensions are refused.
 */
const SHARED_FILES: readonly FileFormat[] = [
  ...DOCUMENTS, ...ARCHIVES, ...IMAGES, 'bmp', 'tiff', 'heif', 'psd', 'dwg', 'stl', 'skp', 'text', 'calendar',
  ...VIDEO, 'avi', 'asf', 'mp3', 'aac', 'wav', 'ogg', 'flac',
]

/**
 * Embedded post images are signed here, not where the media proxy serves from.
 * The upload route republishes the verified bytes to `community-media/…` under a
 * type taken from the bytes, so an object nobody claimed is never reachable.
 */
export const COMMUNITY_MEDIA_STAGING = 'community-media-staging'

const ARTWORK_ERROR = 'That file doesn’t look like a PNG or JPEG image.'
const LICENSE_ERROR = 'That file doesn’t look like a valid image or PDF.'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const UPLOAD_PURPOSES: Record<UploadPurpose, PurposeSpec> = {
  // ── Admin ────────────────────────────────────────────────────────────────
  'admin-resource': {
    bucket: RESOURCES_BUCKET,
    maxBytes: 25 * MB,
    formats: SHARED_FILES,
    sharedFileNames: true,
    async grant({ safeName }) {
      const denied = await requireAdmin()
      return denied ?? { path: `resources/${Date.now()}-${safeName}` }
    },
  },

  'space-resource': {
    bucket: RESOURCES_BUCKET,
    maxBytes: 25 * MB,
    formats: SHARED_FILES,
    sharedFileNames: true,
    async grant({ ctx, safeName }) {
      const denied = await requireAdmin()
      if (denied) return denied
      if (!ctx.spaceId) return deny('spaceId required', 400)
      return { path: `community-resources/${ctx.spaceId}/${Date.now()}-${safeName}` }
    },
  },

  // Lesson content — documents AND video. Video is the reason the old ceiling
  // was untenable: an ffmpeg watermark queue that could only ever receive files
  // under 4.5MB was accepting a format that is rarely that small.
  'training-item': {
    bucket: RESOURCES_BUCKET,
    maxBytes: 200 * MB,
    formats: [...DOCUMENTS, ...IMAGES, ...VIDEO],
    async grant({ safeName }) {
      const denied = await requireAdmin()
      return denied ?? { path: `training/${Date.now()}-${safeName}` }
    },
  },

  'training-item-resource': {
    bucket: RESOURCES_BUCKET,
    maxBytes: 25 * MB,
    formats: SHARED_FILES,
    sharedFileNames: true,
    async grant({ safeName }) {
      const denied = await requireAdmin()
      return denied ?? { path: `training/resources/${Date.now()}-${safeName}` }
    },
  },

  'training-cert-template': {
    bucket: RESOURCES_BUCKET,
    maxBytes: 10 * MB,
    allowedTypes: ['application/pdf'],
    // Overlaid onto every certificate for the course.
    formats: ['pdf'],
    formatError: 'Template must be a PDF',
    async grant({ ctx }) {
      const denied = await requireAdmin()
      if (denied) return denied
      if (!ctx.moduleId) return deny('moduleId required', 400)
      return { path: `training/cert-templates/${ctx.moduleId}-${Date.now()}.pdf` }
    },
  },

  'event-artwork': {
    bucket: RESOURCES_BUCKET,
    maxBytes: 10 * MB,
    formats: ARTWORK,
    formatError: ARTWORK_ERROR,
    async grant({ ctx, safeName }) {
      if (!ctx.slug || !ctx.kind) return deny('slug and kind required', 400)
      // Event managers upload their own event's artwork, so this is the event
      // gate, not the admin one (the claiming route already used it).
      const access = await requireEventAccess(ctx.slug)
      if (!access.ok) return deny('Forbidden', access.status)
      if (!EVENT_ARTWORK_KINDS.includes(ctx.kind)) return deny('Unknown artwork kind', 400)
      return { path: `event-artwork/${ctx.slug}/${ctx.kind}-${Date.now()}-${safeName}` }
    },
  },

  // A theme's default certificate or badge artwork (lib/artwork-defaults.ts),
  // which every event of that theme inherits — so admins only, not event managers.
  'artwork-default': {
    bucket: RESOURCES_BUCKET,
    maxBytes: 10 * MB,
    allowedTypes: ['image/png', 'image/jpeg'],
    formats: ARTWORK,
    formatError: ARTWORK_ERROR,
    async grant({ ctx, safeName }) {
      const denied = await requireAdmin()
      if (denied) return denied
      if (!isArtworkTheme(ctx.theme) || !ctx.kind) return deny('theme and kind required', 400)
      if (!EVENT_ARTWORK_KINDS.includes(ctx.kind)) return deny('Unknown artwork kind', 400)
      return { path: `artwork-defaults/${ctx.theme}/${ctx.kind}-${Date.now()}-${safeName}` }
    },
  },

  // The educator PD certificate artwork, front or back (lib/pd-certificate-store).
  // Staged here, then copied to its page (front/back) by /api/admin/pd-certificate.
  'pd-certificate-artwork': {
    bucket: RESOURCES_BUCKET,
    maxBytes: 10 * MB,
    allowedTypes: ['image/png', 'image/jpeg'],
    formats: ARTWORK,
    formatError: ARTWORK_ERROR,
    async grant({ safeName }) {
      const denied = await requireAdmin()
      return denied ?? { path: `pd-certificate/staged-${Date.now()}-${safeName}` }
    },
  },

  // Attachments for the event "Email Reminders" tab (schedule, RFP…). Event
  // managers attach to their own event's emails, so this is the event gate.
  // 10MB keeps a message under Resend's 40MB total once base64-encoded, with
  // room for more than one file.
  'event-email-attachment': {
    bucket: RESOURCES_BUCKET,
    maxBytes: 10 * MB,
    // Sent to participants, minors included: documents, images (an iPhone's
    // HEIC too), text such as a CSV, and calendar files. No archives or media.
    // The attach route also sends each file under a name and type that match
    // its bytes, not the ones the browser posted.
    formats: [...DOCUMENTS, ...IMAGES, 'heif', 'text', 'calendar'],
    formatError: 'That file doesn’t look like a PDF, Office, OpenDocument, Keynote, image, CSV or calendar file.',
    async grant({ ctx, safeName }) {
      if (!ctx.slug) return deny('slug required', 400)
      const access = await requireEventAccess(ctx.slug)
      if (!access.ok) return deny('Forbidden', access.status)
      return { path: `event-email/${ctx.slug}/${Date.now()}-${safeName}` }
    },
  },

  // A member's teaching license photo/scan, uploaded by an admin on their
  // behalf (e.g. the teacher emailed a copy). Lands in the member's own folder
  // in the private bucket, exactly where their self-upload would, so the claim
  // route (/api/admin/members/[id]/license/document) can pin it to that prefix.
  // The member id is a uuid or nothing: it becomes the first path segment.
  'compliance-document-admin': {
    bucket: LICENSES_BUCKET,
    maxBytes: 10 * MB,
    allowedTypes: LICENSE_TYPES,
    formats: LICENSE_FORMATS,
    formatError: LICENSE_ERROR,
    async grant({ ctx, safeName }) {
      const denied = await requireAdmin()
      if (denied) return denied
      if (!ctx.memberId || !UUID_RE.test(ctx.memberId)) return deny('memberId required', 400)
      const { data: license } = await supabaseServer()
        .from('member_teacher_licenses')
        .select('id')
        .eq('member_id', ctx.memberId)
        .maybeSingle()
      if (!license) return deny('Save the license details first, then attach the document.', 400)
      return { path: `${ctx.memberId}/${Date.now()}-${safeName}` }
    },
  },

  // ── Member ───────────────────────────────────────────────────────────────
  // The form offers PDF, Word, PowerPoint, Keynote and OpenDocument; judges
  // open these, so the bytes must be one of them — not a zip, not an installer,
  // not a macro document — and the name must say which.
  'campaign-proposal': {
    bucket: PROPOSALS_BUCKET,
    maxBytes: 25 * MB,
    formats: DOCUMENTS,
    formatError: 'That file doesn’t look like a PDF, Word, PowerPoint, Keynote or OpenDocument file.',
    async grant({ ctx, safeName }) {
      const member = await requireMember()
      if ('error' in member) return member
      if (!ctx.slug) return deny('slug required', 400)
      const reg = await getMemberCampaignRegistration(member.id, ctx.slug)
      if (!reg) return deny('You are not registered for this campaign.', 404)
      return { path: `${ctx.slug}/${reg.id}/${Date.now()}-${safeName}` }
    },
  },

  'community-media': {
    bucket: RESOURCES_BUCKET,
    maxBytes: 8 * MB,
    allowedTypes: IMAGE_TYPES,
    formats: IMAGES,
    formatError: 'That file doesn’t look like a PNG, JPEG, GIF or WebP image.',
    async grant({ safeName }) {
      const member = await requireMember()
      if ('error' in member) return member
      return { path: `${COMMUNITY_MEDIA_STAGING}/${member.id}/${Date.now()}-${safeName}` }
    },
  },

  // A file attached to a channel post, which auto-saves into the space's
  // Resources. The post↔space check stays on the claiming route.
  'space-attachment': {
    bucket: RESOURCES_BUCKET,
    maxBytes: 25 * MB,
    formats: SHARED_FILES,
    sharedFileNames: true,
    async grant({ ctx, safeName }) {
      const member = await requireMember()
      if ('error' in member) return member
      if (!ctx.spaceSlug) return deny('spaceSlug required', 400)
      const space = await getSpaceForMember(member, ctx.spaceSlug)
      if (!space || !space.access.canAccess) return deny('Forbidden')
      if (!(space.allowMemberUploads || member.isAdmin)) {
        return deny('Uploads are disabled in this space')
      }
      return { path: `${spaceAttachmentPrefix(space.id, member.id)}${Date.now()}-${safeName}` }
    },
  },

  'container-contribution': {
    bucket: RESOURCES_BUCKET,
    maxBytes: 25 * MB,
    formats: SHARED_FILES,
    sharedFileNames: true,
    async grant({ ctx, safeName }) {
      const member = await requireMember()
      if ('error' in member) return member
      if (!ctx.containerId) return deny('containerId required', 400)
      if (!(await memberManagesContainer(member, ctx.containerId))) {
        return deny('You do not manage this object.')
      }
      return { path: `${contributionPrefix(member.id)}${Date.now()}-${safeName}` }
    },
  },

  'compliance-document': {
    bucket: LICENSES_BUCKET,
    maxBytes: 10 * MB,
    allowedTypes: LICENSE_TYPES,
    formats: LICENSE_FORMATS,
    formatError: LICENSE_ERROR,
    async grant({ ctx, safeName }) {
      const member = await requireMember()
      if ('error' in member) return member
      const db = supabaseServer()
      const { data: license } = await db
        .from('member_teacher_licenses')
        .select('id')
        .eq('member_id', member.id)
        .maybeSingle()
      if (!license) {
        return deny('Add your license details first, then attach a photo.', 400)
      }
      void ctx
      return { path: `${member.id}/${Date.now()}-${safeName}` }
    },
  },
}

/**
 * A purpose UPLOAD_PURPOSES defines. Its own keys only: `in` also finds what
 * every object inherits ('toString', 'constructor', '__proto__'), and signing
 * under one of those threw — a 500 from a route anyone can call.
 */
export function isUploadPurpose(value: unknown): value is UploadPurpose {
  return typeof value === 'string' && Object.hasOwn(UPLOAD_PURPOSES, value)
}

/** Issue a signed upload URL for a purpose, or explain why not. */
export async function signUpload(args: {
  purpose: UploadPurpose
  ctx: UploadContext
  fileName: string
  fileSize: number
  contentType: string
}): Promise<{ bucket: string; path: string; token: string } | UploadDenied> {
  const spec = UPLOAD_PURPOSES[args.purpose]

  // POST /api/uploads/sign refuses these too, unauthenticated; this holds for
  // any other caller. Nothing below reads a name of unbounded length.
  if (args.fileName.length > MAX_FILE_NAME_LENGTH) return deny(FILE_NAME_TOO_LONG, 400)
  if (!Number.isFinite(args.fileSize) || args.fileSize <= 0) {
    return deny('That file came through empty — please try again.', 400)
  }
  if (args.fileSize > spec.maxBytes) {
    return deny(`File too large (max ${Math.round(spec.maxBytes / MB)}MB).`, 413)
  }
  if (spec.allowedTypes && !spec.allowedTypes.includes(args.contentType)) {
    return deny('That file type is not accepted here.', 415)
  }
  // Storage serves the object under the type declared here. claimUpload checks
  // the type actually stored too; this just refuses early.
  if (isActiveContentType(args.contentType)) {
    return deny('That file type is not accepted here.', 415)
  }
  // The grant builds the path from the stored name, so that is made first; it
  // swaps unsafe characters for `_`. Every grant only reads (the session,
  // cookies, Supabase selects), so it runs before the name checks below and a
  // caller it refuses never reaches them.
  const safeName = safeFileName(args.fileName)
  const granted = await spec.grant({
    ctx: args.ctx,
    safeName,
    contentType: args.contentType,
  })
  if ('error' in granted) return granted

  // The name: claimUpload decides on the bytes, but a page, script or
  // executable — or any name this purpose never takes — can be turned away
  // before anything is sent. Both the name as sent and the stored one. Only
  // the name has been seen, so the refusal is about the name, as claimUpload's
  // is: not the purpose's formatError, which says what the contents don't look
  // like (an .xlsb "doesn't look like an Office file", though it is one).
  for (const ext of new Set([fileExtension(args.fileName), fileExtension(safeName)])) {
    if (!ext) continue
    if (isDangerousExtension(ext)) return deny(dangerousExtensionError(ext), 415)
    if (!extensionsFor(spec.formats, !spec.sharedFileNames).has(ext)) return deny(notAcceptedError(ext), 415)
  }

  const db = supabaseServer()
  const { data, error } = await db.storage.from(spec.bucket).createSignedUploadUrl(granted.path)
  if (error || !data) {
    console.error('[uploads] signed url error:', args.purpose, error)
    return deny('Could not start the upload.', 500)
  }
  return { bucket: spec.bucket, path: data.path ?? granted.path, token: data.token }
}

function dangerousExtensionError(ext: string): string {
  return `.${ext} files can’t be uploaded: they can run or open as a web page on the computer that downloads them.`
}

function notAcceptedError(ext: string): string {
  return `.${ext} files aren’t accepted here.`
}

/** Delete a stored object, e.g. after a claim is rejected. Never throws. */
export async function discardUpload(bucket: string, path: string): Promise<void> {
  try {
    await supabaseServer().storage.from(bucket).remove([path])
  } catch (err) {
    console.error('[uploads] discard failed:', bucket, path, err)
  }
}

/**
 * Take possession of an object the browser uploaded directly.
 *
 * This is the only place the real bytes are seen, so it is where size and format
 * are enforced — the signing step could only check what the browser claimed.
 * The bytes must sniff as one of the purpose's `formats`, whatever the file is
 * called; the name must fit those bytes (it decides what opens the file once it
 * is downloaded); and the type storage will serve them under must not be one a
 * browser runs. A rejected object is deleted rather than left orphaned in the
 * bucket. The sniffed `format` is returned so a caller can store or send the
 * file under a type derived from it rather than the one the browser posted.
 */
export async function claimUpload(args: {
  purpose: UploadPurpose
  storagePath: string
  /**
   * deep review MEM-13: the namespace prefix the claimed object MUST sit under,
   * derived by the CALLER from the same authorisation it just performed (e.g.
   * spaceAttachmentPrefix for a space attachment). claimUpload trusts the path
   * the browser posts back, so without this a member who can upload anywhere
   * could post a path in another purpose's namespace (or another space/member's
   * folder) and have the owning route adopt the object — or, by failing a check,
   * have it discardUpload-DELETED. Enforced before any storage read/remove.
   * Community write paths MUST pass it, and a member's must be a folder of their
   * own, never one an admin's files share; omitted only where the namespace is
   * already a dedicated private bucket (e.g. teacher-licenses).
   */
  expectedPrefix?: string
}): Promise<ClaimedUpload | UploadDenied> {
  const spec = UPLOAD_PURPOSES[args.purpose]
  const { storagePath, purpose, expectedPrefix } = args

  // Only paths this app issues. An admin is trusted, but a typo must not be able
  // to rewrite an unrelated object (a lesson recording, someone's license).
  // Reject traversal and separator tricks outright (`..`, leading `/`, backslash,
  // and empty-segment `//` that could collapse to a different path), and any
  // path storage would resolve to another one (`%2e%2e`, `./`, `?…`): the prefix
  // pin below, and a caller's "already held" check, compare strings.
  if (!isLiteralStoragePath(storagePath)) {
    return deny('That upload path is not one we issued.', 400)
  }

  // MEM-13: refuse (without touching storage) a path outside the namespace the
  // caller authorised. Fails closed — a mismatch is never downloaded or deleted.
  if (expectedPrefix && !storagePath.startsWith(expectedPrefix)) {
    return deny('That upload path is not one we issued.', 400)
  }

  const db = supabaseServer()
  const { data: stored, error } = await db.storage.from(spec.bucket).download(storagePath)
  if (error || !stored) {
    console.error('[uploads] claim: object missing:', purpose, storagePath, error)
    return deny('The uploaded file could not be found. Please try uploading it again.', 400)
  }

  const bytes = new Uint8Array(await stored.arrayBuffer())

  if (bytes.byteLength === 0) {
    await discardUpload(spec.bucket, storagePath)
    return deny('That file arrived empty — please try again.', 400)
  }
  if (bytes.byteLength > spec.maxBytes) {
    await discardUpload(spec.bucket, storagePath)
    return deny(`File too large (max ${Math.round(spec.maxBytes / MB)}MB).`, 413)
  }
  // S0 content safety: the magic-byte check, for every purpose. A renamed HTML
  // page, SVG, script or executable sniffs as no format and never gets here.
  // Given the purpose's formats, a purpose that takes no text never reads a
  // whole file to refuse it.
  const format = sniffFileFormat(bytes, spec.formats)
  if (!format || !spec.formats.includes(format)) {
    await discardUpload(spec.bucket, storagePath)
    return deny(spec.formatError ?? 'That file isn’t a type accepted here, or its contents don’t match its name.', 415)
  }
  // The name is what a downloader's computer acts on: a real PDF kept as
  // `x.html` opens as a page. Signing refused the obvious cases; this is the
  // check that counts, against the path the object actually has.
  const ext = fileExtension(storagePath)
  const strict = !spec.sharedFileNames
  if (!nameMatchesFormat(storagePath, format, strict)) {
    await discardUpload(spec.bucket, storagePath)
    return deny(
      isDangerousExtension(ext)
        ? dangerousExtensionError(ext)
        : extensionsFor(spec.formats, strict).has(ext)
          ? `That file’s contents don’t match its .${ext} name.`
          : notAcceptedError(ext),
      415,
    )
  }
  // Real bytes under an active type are still a page: a PDF stored as text/html
  // renders as HTML. The blob carries the type storage serves the object with.
  if (isActiveContentType(stored.type)) {
    await discardUpload(spec.bucket, storagePath)
    return deny('That file type is not accepted here.', 415)
  }

  return { bytes, bucket: spec.bucket, format }
}

/** Overwrite a claimed object in place, e.g. after watermarking it. */
export async function replaceUpload(
  bucket: string,
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<boolean> {
  const { error } = await supabaseServer()
    .storage.from(bucket)
    .upload(path, bytes, { contentType, upsert: true })
  if (error) console.error('[uploads] replace failed:', bucket, path, error)
  return !error
}
