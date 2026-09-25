import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { claimUpload } from '@/lib/uploads'
import { requireEventAccess } from '@/lib/event-access'
import { isAwardType } from '@/lib/event-awards'
import { loadTemplate, loadTemplates } from '@/lib/event-certificates'

export const dynamic = 'force-dynamic'

// Certificate artwork, one per award. GET lists all four; PUT replaces the
// artwork (a path already uploaded browser → storage via /api/uploads/sign,
// kind certificate-<award>) and/or moves the name.

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  return NextResponse.json({ templates: await loadTemplates(supabaseServer(), slug) })
}

const isPng = (b: Uint8Array) => b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
const isJpeg = (b: Uint8Array) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff

// PUT { awardType, storagePath?, fileType?, name_y?, name_max_width?, name_size? }
export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const awardType = b.awardType
  if (!isAwardType(awardType)) return NextResponse.json({ error: 'awardType is required' }, { status: 400 })

  const db = supabaseServer()
  const update: Record<string, unknown> = { event_slug: slug, award_type: awardType }

  const storagePath = typeof b.storagePath === 'string' ? b.storagePath : ''
  if (storagePath) {
    const fileType = typeof b.fileType === 'string' ? b.fileType : ''
    if (!['image/png', 'image/jpeg'].includes(fileType)) {
      return NextResponse.json({ error: 'Artwork must be a PNG or JPEG image' }, { status: 400 })
    }
    if (!storagePath.startsWith(`event-artwork/${slug}/certificate-${awardType}-`)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const claimed = await claimUpload({
      purpose: 'event-artwork',
      storagePath,
      // A signed URL accepts any bytes; the renderer can only use these two.
      verify: (bytes) => isPng(bytes) || isJpeg(bytes),
      verifyError: 'That file doesn’t look like a PNG or JPEG image.',
    })
    if ('error' in claimed) return NextResponse.json({ error: claimed.error }, { status: claimed.status })
    update.artwork_path = storagePath
  }

  const num = (k: string, min: number, max: number) => {
    if (b[k] === undefined) return undefined
    const v = Number(b[k])
    return Number.isFinite(v) && v >= min && v <= max ? v : null
  }
  const placement = {
    name_y: num('name_y', 0.01, 0.99),
    name_max_width: num('name_max_width', 0.05, 1),
    name_size: num('name_size', 8, 120),
  }
  for (const [k, v] of Object.entries(placement)) {
    if (v === null) return NextResponse.json({ error: `${k} is out of range` }, { status: 400 })
    if (v !== undefined) update[k] = v
  }

  const existing = await loadTemplate(db, slug, awardType)
  if (!existing && !update.artwork_path) {
    return NextResponse.json({ error: 'Upload the artwork before positioning the name.' }, { status: 400 })
  }

  const { error } = await db.from('event_certificate_templates').upsert(update, { onConflict: 'event_slug,award_type' })
  if (error) {
    console.error('[certificate templates] upsert error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, template: await loadTemplate(db, slug, awardType) })
}
