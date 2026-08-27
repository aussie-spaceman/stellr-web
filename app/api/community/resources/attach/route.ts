import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { getSpaceForMember } from '@/lib/spaces'
import { supabaseServer } from '@/lib/supabase'
import { attachSpaceResource } from '@/lib/container-sync'
import { assertNotImpersonating } from '@/lib/impersonation'
import { claimUpload, discardUpload } from '@/lib/uploads'
import { watermarkIfPdf } from '@/lib/resource-finalise'

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
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

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

  const claimed = await claimUpload({ purpose: 'space-attachment', storagePath })
  if ('error' in claimed) return NextResponse.json({ error: claimed.error }, { status: claimed.status })

  // Copyright watermark on the bottom-right of every page of uploaded PDFs.
  const bytes = await watermarkIfPdf(claimed.bucket, storagePath, claimed.bytes, fileType)

  const { data, error } = await db
    .from('community_resources')
    .insert({
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
  await attachSpaceResource(db, space.id, data.id)

  return NextResponse.json({ id: data.id })
}
