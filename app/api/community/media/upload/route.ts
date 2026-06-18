import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { supabaseServer } from '@/lib/supabase'
import { RESOURCES_BUCKET } from '@/lib/community'

const MAX_BYTES = 8 * 1024 * 1024 // 8 MB
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

// POST /api/community/media/upload — a member uploads an image to embed in a
// post/comment. Stored privately under community-media/<memberId>/; served back
// through the access-gated proxy at /api/community/media/<path>. Returns { src }.
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (!ALLOWED.has(file.type)) return NextResponse.json({ error: 'Unsupported image type' }, { status: 415 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Image too large (max 8MB)' }, { status: 413 })

  // Filename: timestamp-ish from size + name hash isn't needed; use a random-ish
  // suffix derived from the upload to avoid collisions without Math.random here.
  const rand = Buffer.from(`${member.id}:${file.name}:${file.size}`).toString('base64url').slice(0, 12)
  const path = `community-media/${member.id}/${rand}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}.${EXT[file.type]}`

  const db = supabaseServer()
  const bytes = new Uint8Array(await file.arrayBuffer())
  const { error } = await db.storage.from(RESOURCES_BUCKET).upload(path, bytes, {
    contentType: file.type,
    upsert: true,
  })
  if (error) {
    console.error('[community] media upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }

  return NextResponse.json({ src: `/api/community/media/${path.split('/').map(encodeURIComponent).join('/')}` })
}
