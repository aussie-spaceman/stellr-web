import { NextResponse } from 'next/server'
import { getCurrentMember, RESOURCES_BUCKET } from '@/lib/community'
import { getSpaceForMember } from '@/lib/spaces'
import { supabaseServer } from '@/lib/supabase'
import { attachSpaceResource } from '@/lib/container-sync'
import { isPdf, stampPdfBytes } from '@/lib/watermark/pdf'

const MAX_BYTES = 25 * 1024 * 1024 // 25 MB

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

// POST /api/community/resources/attach (multipart) — a file attached to a channel
// post auto-saves into the space's Resources (from_chat), inheriting space access.
// Body: { spaceSlug, postId, file }.
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  const spaceSlug = String(form?.get('spaceSlug') ?? '')
  const postId = String(form?.get('postId') ?? '')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (!spaceSlug || !postId) return NextResponse.json({ error: 'spaceSlug and postId required' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File too large (max 25MB)' }, { status: 413 })

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

  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const rand = Buffer.from(`${member.id}:${file.name}:${file.size}`).toString('base64url').slice(0, 12)
  const path = `community-resources/${space.id}/${rand}-${safe}`

  let bytes = new Uint8Array(await file.arrayBuffer())
  // Copyright watermark on the bottom-right of every page of uploaded PDFs.
  if (isPdf(file.name, file.type)) {
    try {
      bytes = new Uint8Array(await stampPdfBytes(bytes))
    } catch (err) {
      console.error('[community] resource watermark failed, storing original:', err)
    }
  }
  const { error: upErr } = await db.storage.from(RESOURCES_BUCKET).upload(path, bytes, {
    contentType: file.type || 'application/octet-stream',
    upsert: true,
  })
  if (upErr) {
    console.error('[community] resource attach upload error:', upErr)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }

  const { data, error } = await db
    .from('community_resources')
    .insert({
      space_id: space.id,
      title: file.name,
      storage_path: path,
      file_type: fileLabel(file.name, file.type || ''),
      file_size_bytes: bytes.byteLength,
      uploaded_by: member.id,
      from_chat: true,
      source_post_id: postId,
    })
    .select('id')
    .single()
  if (error) {
    console.error('[community] resource attach insert error:', error)
    return NextResponse.json({ error: 'Failed to save resource' }, { status: 500 })
  }

  // Surface it in the global catalogue (container_contents on the space container).
  await attachSpaceResource(db, space.id, data.id)

  return NextResponse.json({ id: data.id })
}
