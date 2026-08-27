import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { RESOURCES_BUCKET, getCurrentMember, type CommunityMember } from '@/lib/community'
import { assertNotImpersonating } from '@/lib/impersonation'
import { getSpaceForMember } from '@/lib/spaces'
import { getMemberCampaignRegistration } from '@/lib/campaign-registrations'
import { memberManagesContainer } from '@/lib/resource-upload'

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
//
// Two layers of authorisation, deliberately:
//   sign  — may this caller write bytes into this purpose's namespace at all?
//   claim — the owning route re-checks the specific object-level rule (does this
//           member manage that container, is that post in that space, …) before
//           anything is recorded. A signed URL alone never makes a file reachable:
//           the buckets are private and nothing is served without a row.

export const PROPOSALS_BUCKET = 'campaign-proposals'
export const LICENSES_BUCKET = 'teacher-licenses'

const MB = 1024 * 1024

export type UploadPurpose =
  | 'admin-resource'
  | 'space-resource'
  | 'training-item'
  | 'training-item-resource'
  | 'training-cert-template'
  | 'event-artwork'
  | 'campaign-proposal'
  | 'community-media'
  | 'space-attachment'
  | 'container-contribution'
  | 'compliance-document'

export type UploadContext = Record<string, string | undefined>

export type UploadDenied = { error: string; status: number }
type Granted = { path: string }

type PurposeSpec = {
  bucket: string
  maxBytes: number
  /** Exact mime allowlist. Undefined means any type is acceptable. */
  allowedTypes?: readonly string[]
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

/** Strip anything that could escape the intended prefix. */
export function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file'
}

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

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
const LICENSE_TYPES = [
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic', 'application/pdf',
] as const

export const UPLOAD_PURPOSES: Record<UploadPurpose, PurposeSpec> = {
  // ── Admin ────────────────────────────────────────────────────────────────
  'admin-resource': {
    bucket: RESOURCES_BUCKET,
    maxBytes: 25 * MB,
    async grant({ safeName }) {
      const denied = await requireAdmin()
      return denied ?? { path: `resources/${Date.now()}-${safeName}` }
    },
  },

  'space-resource': {
    bucket: RESOURCES_BUCKET,
    maxBytes: 25 * MB,
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
    async grant({ safeName }) {
      const denied = await requireAdmin()
      return denied ?? { path: `training/${Date.now()}-${safeName}` }
    },
  },

  'training-item-resource': {
    bucket: RESOURCES_BUCKET,
    maxBytes: 25 * MB,
    async grant({ safeName }) {
      const denied = await requireAdmin()
      return denied ?? { path: `training/resources/${Date.now()}-${safeName}` }
    },
  },

  'training-cert-template': {
    bucket: RESOURCES_BUCKET,
    maxBytes: 10 * MB,
    allowedTypes: ['application/pdf'],
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
    async grant({ ctx, safeName }) {
      const denied = await requireAdmin()
      if (denied) return denied
      if (!ctx.slug || !ctx.kind) return deny('slug and kind required', 400)
      return { path: `event-artwork/${ctx.slug}/${ctx.kind}-${Date.now()}-${safeName}` }
    },
  },

  // ── Member ───────────────────────────────────────────────────────────────
  'campaign-proposal': {
    bucket: PROPOSALS_BUCKET,
    maxBytes: 25 * MB,
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
    async grant({ safeName }) {
      const member = await requireMember()
      if ('error' in member) return member
      return { path: `community-media/${member.id}/${Date.now()}-${safeName}` }
    },
  },

  // A file attached to a channel post, which auto-saves into the space's
  // Resources. The post↔space check stays on the claiming route.
  'space-attachment': {
    bucket: RESOURCES_BUCKET,
    maxBytes: 25 * MB,
    async grant({ ctx, safeName }) {
      const member = await requireMember()
      if ('error' in member) return member
      if (!ctx.spaceSlug) return deny('spaceSlug required', 400)
      const space = await getSpaceForMember(member, ctx.spaceSlug)
      if (!space || !space.access.canAccess) return deny('Forbidden')
      if (!(space.allowMemberUploads || member.isAdmin)) {
        return deny('Uploads are disabled in this space')
      }
      return { path: `community-resources/${space.id}/${Date.now()}-${safeName}` }
    },
  },

  'container-contribution': {
    bucket: RESOURCES_BUCKET,
    maxBytes: 25 * MB,
    async grant({ ctx, safeName }) {
      const member = await requireMember()
      if ('error' in member) return member
      if (!ctx.containerId) return deny('containerId required', 400)
      if (!(await memberManagesContainer(member, ctx.containerId))) {
        return deny('You do not manage this object.')
      }
      return { path: `resources/${Date.now()}-${safeName}` }
    },
  },

  'compliance-document': {
    bucket: LICENSES_BUCKET,
    maxBytes: 10 * MB,
    allowedTypes: LICENSE_TYPES,
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

export function isUploadPurpose(value: unknown): value is UploadPurpose {
  return typeof value === 'string' && value in UPLOAD_PURPOSES
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

  if (!Number.isFinite(args.fileSize) || args.fileSize <= 0) {
    return deny('That file came through empty — please try again.', 400)
  }
  if (args.fileSize > spec.maxBytes) {
    return deny(`File too large (max ${Math.round(spec.maxBytes / MB)}MB).`, 413)
  }
  if (spec.allowedTypes && !spec.allowedTypes.includes(args.contentType)) {
    return deny('That file type is not accepted here.', 415)
  }

  const granted = await spec.grant({
    ctx: args.ctx,
    safeName: safeFileName(args.fileName),
    contentType: args.contentType,
  })
  if ('error' in granted) return granted

  const db = supabaseServer()
  const { data, error } = await db.storage.from(spec.bucket).createSignedUploadUrl(granted.path)
  if (error || !data) {
    console.error('[uploads] signed url error:', args.purpose, error)
    return deny('Could not start the upload.', 500)
  }
  return { bucket: spec.bucket, path: data.path ?? granted.path, token: data.token }
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
 * A rejected object is deleted rather than left orphaned in the bucket.
 */
export async function claimUpload(args: {
  purpose: UploadPurpose
  storagePath: string
  /** Extra format gate, e.g. the license magic-byte sniff. */
  verify?: (bytes: Uint8Array) => boolean
  verifyError?: string
}): Promise<{ bytes: Uint8Array; bucket: string } | UploadDenied> {
  const spec = UPLOAD_PURPOSES[args.purpose]
  const { storagePath, purpose } = args

  // Only paths this app issues. An admin is trusted, but a typo must not be able
  // to rewrite an unrelated object (a lesson recording, someone's license).
  if (storagePath.includes('..') || storagePath.startsWith('/')) {
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
  if (args.verify && !args.verify(bytes)) {
    await discardUpload(spec.bucket, storagePath)
    return deny(args.verifyError ?? 'That file type is not accepted here.', 400)
  }

  return { bytes, bucket: spec.bucket }
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
