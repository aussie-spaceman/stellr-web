import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { RESOURCES_BUCKET } from '@/lib/community'
import { attachSpaceResource } from '@/lib/container-sync'
import { isPdf, stampPdfBytes } from '@/lib/watermark/pdf'

// POST /api/admin/community/spaces/[id]/resources (multipart) — admin uploads a
// file into a space's Resources (Assign resource modal, screen 20).

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}
const MAX_BYTES = 25 * 1024 * 1024

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

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId, sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id: spaceId } = await params

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File too large (max 25MB)' }, { status: 413 })

  const db = supabaseServer()
  let adminMemberId: string | null = null
  if (userId) {
    const { data } = await db.from('members').select('id').eq('clerk_user_id', userId).maybeSingle()
    adminMemberId = (data as { id: string } | null)?.id ?? null
  }

  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const rand = Buffer.from(`${spaceId}:${file.name}:${file.size}`).toString('base64url').slice(0, 12)
  const path = `community-resources/${spaceId}/${rand}-${safe}`

  let bytes = new Uint8Array(await file.arrayBuffer())
  // Copyright watermark on the bottom-right of every page of uploaded PDFs.
  if (isPdf(file.name, file.type)) {
    try {
      bytes = new Uint8Array(await stampPdfBytes(bytes))
    } catch (err) {
      console.error('[admin] resource watermark failed, storing original:', err)
    }
  }
  const { error: upErr } = await db.storage.from(RESOURCES_BUCKET).upload(path, bytes, {
    contentType: file.type || 'application/octet-stream',
    upsert: true,
  })
  if (upErr) {
    console.error('[admin] resource upload error:', upErr)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }

  const { data, error } = await db
    .from('community_resources')
    .insert({
      space_id: spaceId,
      title: String(form?.get('title') ?? '').trim() || file.name,
      storage_path: path,
      file_type: fileLabel(file.name, file.type || ''),
      file_size_bytes: bytes.byteLength,
      uploaded_by: adminMemberId,
      from_chat: false,
    })
    .select('id')
    .single()
  if (error) {
    console.error('[admin] resource insert error:', error)
    return NextResponse.json({ error: 'Failed to save resource' }, { status: 500 })
  }
  await attachSpaceResource(db, spaceId, data.id)
  return NextResponse.json({ id: data.id })
}
