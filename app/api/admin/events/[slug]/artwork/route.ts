import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { claimUpload } from '@/lib/uploads'
import { requireEventAccess } from '@/lib/event-access'

// POST /api/admin/events/[slug]/artwork — upload badge or certificate background.
// FormData: { kind: 'badge' | 'certificate', file: png/jpeg }
// Stored in the existing private community-resources bucket under event-artwork/.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  // The bytes went browser → storage via /api/uploads/sign; only the path lands
  // here. The 10MB this route advertised was never reachable — the platform
  // rejected any body over 4.5MB before the function ran.
  const b = await req.json().catch(() => ({}))
  const kind = b.kind
  const storagePath = typeof b.storagePath === 'string' ? b.storagePath : ''
  const fileType = typeof b.fileType === 'string' ? b.fileType : ''
  if ((kind !== 'badge' && kind !== 'certificate') || !storagePath) {
    return NextResponse.json({ error: 'kind (badge|certificate) and storagePath are required' }, { status: 400 })
  }
  if (!['image/png', 'image/jpeg'].includes(fileType)) {
    return NextResponse.json({ error: 'Artwork must be a PNG or JPEG image' }, { status: 400 })
  }
  if (!storagePath.startsWith(`event-artwork/${slug}/${kind}-`)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = supabaseServer()
  const claimed = await claimUpload({
    purpose: 'event-artwork',
    storagePath,
    // A signed URL accepts any bytes, so confirm the stored object really is
    // one of the two image formats the certificate/badge renderer can use.
    verify: (bytes) =>
      (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) ||
      (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff),
    verifyError: 'That file doesn’t look like a PNG or JPEG image.',
  })
  if ('error' in claimed) return NextResponse.json({ error: claimed.error }, { status: claimed.status })

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
