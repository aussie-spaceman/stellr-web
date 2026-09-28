import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { claimUpload } from '@/lib/uploads'
import { requireEventAccess } from '@/lib/event-access'
import { BADGE_FORMATS, isBadgeFormat, placementFromLine, type BadgeAudience } from '@/lib/badge-layout'
import { prepareBadgeArtwork } from '@/lib/badge-artwork'
import { loadBadgeTemplate, loadBadgeTemplates, loadCompanies, placementOf, prepareTemplate } from '@/lib/event-badges'

export const dynamic = 'force-dynamic'

// Name badge templates: one background per Avery format per audience
// (everyone, mentors, or one company). GET lists them with the event's
// companies; PUT sets artwork (uploaded browser → storage via
// /api/uploads/sign, kind = the format's artworkKind) and/or moves the name;
// DELETE removes a mentor or company override.

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const db = supabaseServer()
  const [templates, companies] = await Promise.all([loadBadgeTemplates(db, slug), loadCompanies(db, slug)])
  // Rows carried over from event_settings were never positioned: show the
  // position the renderer will use, found from the artwork's rule.
  for (const t of templates) {
    if (t.name_x !== null && t.name_y !== null && t.name_max_width !== null && t.name_size !== null) continue
    const prepared = await prepareTemplate(db, t)
    if (!prepared) continue
    const p = placementOf(t, prepared)
    Object.assign(t, { name_x: p.nameX, name_y: p.nameY, name_max_width: p.nameMaxWidth, name_size: p.nameSize })
  }
  return NextResponse.json({ templates, companies })
}

const isPng = (b: Uint8Array) => b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
const isJpeg = (b: Uint8Array) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
const AUDIENCES: BadgeAudience[] = ['everyone', 'mentors', 'company']

// PUT { format, audience, companyId?, storagePath?, fileType?, name_x?, name_y?, name_max_width?, name_size?, reset? }
// New artwork resets the placement to one found from the artwork's rule;
// the reply says whether a rule was found.
export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const format = b.format
  const audience = b.audience as BadgeAudience
  const companyId = audience === 'company' && typeof b.companyId === 'string' ? b.companyId : null
  if (!isBadgeFormat(format) || !AUDIENCES.includes(audience) || (audience === 'company' && !companyId)) {
    return NextResponse.json({ error: 'format and audience (with companyId for a company) are required' }, { status: 400 })
  }

  const db = supabaseServer()
  if (companyId) {
    const { data: company } = await db.from('event_companies').select('id').eq('id', companyId).eq('event_slug', slug).maybeSingle()
    if (!company) return NextResponse.json({ error: 'That company is not in this event' }, { status: 400 })
  }

  let q = db.from('event_badge_templates').select('id').eq('event_slug', slug).eq('format', format).eq('audience', audience)
  q = companyId ? q.eq('company_id', companyId) : q.is('company_id', null)
  const { data: existing } = await q.maybeSingle()

  const update: Record<string, unknown> = {}
  let lineFound: boolean | null = null

  const storagePath = typeof b.storagePath === 'string' ? b.storagePath : ''
  if (storagePath) {
    const fileType = typeof b.fileType === 'string' ? b.fileType : ''
    if (!['image/png', 'image/jpeg'].includes(fileType)) {
      return NextResponse.json({ error: 'Artwork must be a PNG or JPEG image' }, { status: 400 })
    }
    if (!storagePath.startsWith(`event-artwork/${slug}/${BADGE_FORMATS[format].artworkKind}-`)) {
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

    // A starting placement from the artwork's rule. Advisory: without one the
    // name is centred, and the admin can move it either way.
    try {
      const prepared = await prepareBadgeArtwork({ bytes: claimed.bytes, mime: fileType }, format)
      lineFound = prepared.line !== null
      const p = placementFromLine(prepared.line, format)
      Object.assign(update, { name_x: p.nameX, name_y: p.nameY, name_max_width: p.nameMaxWidth, name_size: p.nameSize })
    } catch (err) {
      console.error('[badge templates] rule detection failed:', err)
      Object.assign(update, { name_x: null, name_y: null, name_max_width: null, name_size: null })
    }
  }

  const n = (k: string, min: number, max: number) => {
    if (b[k] === undefined) return undefined
    const v = Number(b[k])
    return Number.isFinite(v) && v >= min && v <= max ? v : null
  }
  const placement = {
    name_x: n('name_x', 0.01, 0.99),
    name_y: n('name_y', 0.01, 0.99),
    name_max_width: n('name_max_width', 0.05, 1),
    name_size: n('name_size', 6, 72),
  }
  for (const [k, v] of Object.entries(placement)) {
    if (v === null) return NextResponse.json({ error: `${k} is out of range` }, { status: 400 })
    if (v !== undefined && !storagePath) update[k] = v
  }

  // Back to the position found from the artwork's rule.
  if (b.reset === true && !storagePath && existing) {
    const t = await loadBadgeTemplate(db, slug, existing.id)
    const prepared = t ? await prepareTemplate(db, t) : null
    if (!prepared) return NextResponse.json({ error: 'The background could not be loaded. Upload it again.' }, { status: 500 })
    lineFound = prepared.line !== null
    const p = placementFromLine(prepared.line, format)
    Object.assign(update, { name_x: p.nameX, name_y: p.nameY, name_max_width: p.nameMaxWidth, name_size: p.nameSize })
  }

  if (!existing && !update.artwork_path) {
    return NextResponse.json({ error: 'Upload the background before positioning the name.' }, { status: 400 })
  }

  const { data: saved, error } = existing
    ? await db.from('event_badge_templates').update(update).eq('id', existing.id).select('id').single()
    : await db
        .from('event_badge_templates')
        .insert({ ...update, event_slug: slug, format, audience, company_id: companyId })
        .select('id')
        .single()
  if (error || !saved) {
    console.error('[badge templates] save error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, lineFound, template: await loadBadgeTemplate(db, slug, saved.id) })
}

// DELETE ?id= — drop a template. Those badges fall back to the next template
// down (company → mentors → everyone → plain).
export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const id = new URL(req.url).searchParams.get('id') ?? ''
  const { error } = await supabaseServer().from('event_badge_templates').delete().eq('event_slug', slug).eq('id', id)
  if (error) {
    console.error('[badge templates] delete error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
