import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
import { RESOURCES_BUCKET } from '@/lib/community'

// POST /api/admin/events/[slug]/artwork — upload badge or certificate background.
// FormData: { kind: 'badge' | 'certificate', file: png/jpeg }
// Stored in the existing private community-resources bucket under event-artwork/.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const formData = await req.formData()
  const kind = formData.get('kind')
  const file = formData.get('file') as File | null
  if ((kind !== 'badge' && kind !== 'certificate') || !file) {
    return NextResponse.json({ error: 'kind (badge|certificate) and file are required' }, { status: 400 })
  }
  if (!['image/png', 'image/jpeg'].includes(file.type)) {
    return NextResponse.json({ error: 'Artwork must be a PNG or JPEG image' }, { status: 400 })
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: 'Artwork must be under 10MB' }, { status: 400 })
  }

  const db = supabaseServer()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `event-artwork/${slug}/${kind}-${Date.now()}-${safeName}`

  const { error: uploadError } = await db.storage
    .from(RESOURCES_BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false })
  if (uploadError) {
    console.error('[event artwork] upload error:', uploadError)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }

  const column = kind === 'badge' ? 'badge_artwork_path' : 'certificate_artwork_path'
  const { error: dbError } = await db
    .from('event_settings')
    .upsert({ event_slug: slug, [column]: storagePath }, { onConflict: 'event_slug' })
  if (dbError) {
    console.error('[event artwork] settings error:', dbError)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, path: storagePath })
}
