import { NextResponse } from 'next/server'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { communityWriteBlock } from '@/lib/community'
import { getOnboardedMember } from '@/lib/onboarded-member'
import { getSpaceForMember } from '@/lib/spaces'
import { supabaseServer } from '@/lib/supabase'
import { attachSpaceResource } from '@/lib/container-sync'
import { assertNotImpersonating } from '@/lib/impersonation'
import { claimUpload, discardUpload, spaceAttachmentPrefix } from '@/lib/uploads'
import { watermarkIfPdf } from '@/lib/resource-finalise'
import { auditMutation } from '@/lib/audit/route'
import { noteAudit, selfServiceEvent, type SelfServiceAudit } from '@/lib/community/self-service-audit'

// Claiming a stored upload re-reads and may rewrite it (watermark).
export const maxDuration = 60

// Short, colour-coded file-type label for the Resources list / attachment chip.
function fileLabel(name: string, mime: string): string {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  if (mime.startsWith('image/')) return 'IMG'
  if (ext === 'pdf' || mime === 'application/pdf') return 'PDF'
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'XLS'
  if (['doc', 'docx'].includes(ext)) return 'DOC'
  if (['ppt', 'pptx'].includes(ext)) return 'PPT'
  if (['dwg', 'dxf', 'step', 'stp', 'stl', 'f3d'].includes(ext)) return 'CAD'
  if (['zip', 'rar', '7z'].includes(ext)) return 'ZIP'
  return (ext || 'file').toUpperCase().slice(0, 4)
}

// POST /api/community/resources/attach (JSON) — a file attached to a channel post
// auto-saves into the space's Resources (from_chat), inheriting space access.
// Body: { spaceSlug, postId, storagePath, fileName, fileType } — the bytes were
// already sent straight to storage via /api/uploads/sign.
export async function POST(req: Request) {
  return audited(req, { action: 'community.resource.attach', table: 'community_resources' }, () => attachResource(req))
}

async function attachResource(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getOnboardedMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  // Decision 24: age and guardian-consent restrictions (lib/community).
  const restricted = await communityWriteBlock(member, 'upload')
  if (restricted) return restricted

  // The bytes went browser → storage via /api/uploads/sign; only the path lands
  // here. Vercel caps a request body at 4.5MB before the function runs, so the
  // 25MB this route used to advertise was never actually reachable.
  const b = await req.json().catch(() => ({}))
  const storagePath = typeof b.storagePath === 'string' ? b.storagePath : ''
  const fileName = typeof b.fileName === 'string' ? b.fileName : ''
  const fileType = typeof b.fileType === 'string' ? b.fileType : ''
  const spaceSlug = String(b.spaceSlug ?? '')
  const postId = String(b.postId ?? '')
  if (!storagePath || !fileName) return NextResponse.json({ error: 'storagePath and fileName required' }, { status: 400 })
  if (!spaceSlug || !postId) return NextResponse.json({ error: 'spaceSlug and postId required' }, { status: 400 })

  const space = await getSpaceForMember(member, spaceSlug)
  if (!space || !space.access.canAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(space.allowMemberUploads || member.isAdmin)) {
    return NextResponse.json({ error: 'Uploads are disabled in this space' }, { status: 403 })
  }

  const db = supabaseServer()

  // Confirm the post belongs to this space (don't let a forged postId attach elsewhere).
  const { data: post } = await db
    .from('community_posts')
    .select('id, space_id')
    .eq('id', postId)
    .maybeSingle()
  if (!post || (post as { space_id: string }).space_id !== space.id) {
    return NextResponse.json({ error: 'Post not found in this space' }, { status: 404 })
  }

  // One upload, one resource. Claiming downloads and sniffs the whole object (up
  // to 25MB) and re-stamps a PDF, and nothing else stops a member posting the
  // same path back again and again, each time adding another row. A path a
  // resource already holds is refused before anything reads it.
  const { data: holders, error: holderError } = await db
    .from('community_resources')
    .select('id')
    .eq('storage_path', storagePath)
    .limit(1)
  if (holderError) {
    return NextResponse.json({ error: 'Could not check that upload. Please try again.' }, { status: 500 })
  }
  if ((holders ?? []).length > 0) {
    return NextResponse.json(
      { error: 'That file is already saved to Resources. Upload it again to attach it here.' },
      { status: 409 },
    )
  }

  // deep review MEM-13: pin the claim to this member's own folder in THIS space,
  // the exact prefix signUpload issued. Without it a member could post back a
  // path in another space, a training folder or an admin's space file (they sit
  // in community-resources/<spaceId>/ too) and have it adopted here — or deleted
  // by a refused claim.
  const claimed = await claimUpload({
    purpose: 'space-attachment',
    storagePath,
    expectedPrefix: spaceAttachmentPrefix(space.id, member.id),
  })
  if ('error' in claimed) return NextResponse.json({ error: claimed.error }, { status: claimed.status })

  // Copyright watermark on the bottom-right of every page of uploaded PDFs.
  const bytes = await watermarkIfPdf(claimed.bucket, storagePath, claimed.bytes, fileType)
  if ('error' in bytes) return NextResponse.json({ error: bytes.error }, { status: bytes.status })

  const { data, error } = await db
    .from('community_resources')
    .insert({
      tenant_id: STELLR_TENANT_ID,
      space_id: space.id,
      title: fileName,
      storage_path: storagePath,
      file_type: fileLabel(fileName, fileType),
      file_size_bytes: bytes.byteLength,
      uploaded_by: member.id,
      from_chat: true,
      source_post_id: postId,
    })
    .select('id')
    .single()
  if (error) {
    await discardUpload(claimed.bucket, storagePath)
    console.error('[community] resource attach insert error:', error)
    return NextResponse.json({ error: 'Failed to save resource' }, { status: 500 })
  }

  // Surface it in the global catalogue (container_contents on the space container).
  noteAudit(req, { targetId: data.id })
  await attachSpaceResource(db, space.id, data.id)

  return NextResponse.json({ id: data.id })
}

// The audit event for this route (docs/TENANCY-S5.md, B16): written after the response,
// never for a 4xx, ids and short codes only. lib/community/self-service-audit decides
// what is written; the call stays here because the coverage gate reads it here.
async function audited(req: Request, spec: SelfServiceAudit, run: () => Promise<Response>): Promise<Response> {
  let res: Response | undefined
  try {
    return (res = await run())
  } finally {
    await record(req, res, spec)
  }
}

async function record(req: Request, res: Response | undefined, spec: SelfServiceAudit) {
  const event = await selfServiceEvent(req, res, spec)
  if (!event) return
  await auditMutation(event, { afterResponse: true })
}
