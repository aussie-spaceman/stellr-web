import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { currentUserIsAdmin } from '@/lib/admin-auth'
import { BADGE_FORMATS, isBadgeFormat, placementFromLine } from '@/lib/badge-layout'
import { isArtworkTheme } from '@/lib/artwork-theme'
import { BADGE_PLACEMENT_RANGES, badgePlacementFromArtwork, claimArtwork, placementInput } from '@/lib/artwork-template-input'
import { fillPlacements, loadDefaultBadgeTemplate, loadDefaultBadgeTemplates, prepareTemplate } from '@/lib/event-badges'

export const dynamic = 'force-dynamic'

// A theme's default name badge backgrounds, everyone and mentors per Avery
// format: what every event of that theme prints for a slot it has not filled
// (lib/artwork-defaults.ts). Admins only. Mirrors
// /api/admin/events/[slug]/badge-templates, without companies (those belong to
// one event). Badges are printed before an event, so replacing one pins
// nothing.

type Ctx = { params: Promise<{ theme: string }> }
const AUDIENCES = ['everyone', 'mentors'] as const
type DefaultAudience = (typeof AUDIENCES)[number]

export async function GET(_req: Request, { params }: Ctx) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { theme } = await params
  if (!isArtworkTheme(theme)) return NextResponse.json({ error: 'Unknown theme' }, { status: 404 })
  const db = supabaseServer()
  return NextResponse.json({ theme, templates: await fillPlacements(db, await loadDefaultBadgeTemplates(db, theme)) })
}

// PUT { format, audience, storagePath?, fileType?, name_x?, name_y?, name_max_width?, name_size?, reset? }
export async function PUT(req: Request, { params }: Ctx) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { theme } = await params
  if (!isArtworkTheme(theme)) return NextResponse.json({ error: 'Unknown theme' }, { status: 404 })

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const format = b.format
  const audience = b.audience as DefaultAudience
  if (!isBadgeFormat(format) || !AUDIENCES.includes(audience)) {
    return NextResponse.json({ error: 'format and audience (everyone or mentors) are required' }, { status: 400 })
  }

  const db = supabaseServer()
  const { data: existing } = await db
    .from('default_badge_templates')
    .select('id')
    .eq('theme', theme)
    .eq('format', format)
    .eq('audience', audience)
    .maybeSingle()

  const update: Record<string, unknown> = {}
  let lineFound: boolean | null = null

  const art = await claimArtwork(b, 'artwork-default', `artwork-defaults/${theme}/${BADGE_FORMATS[format].artworkKind}-`)
  if (art && 'error' in art) return NextResponse.json({ error: art.error }, { status: art.status })
  if (art) {
    update.artwork_path = art.path
    const found = await badgePlacementFromArtwork(art, format)
    lineFound = found.lineFound
    Object.assign(update, found.placement)
  } else {
    const placement = placementInput(b, BADGE_PLACEMENT_RANGES)
    if ('error' in placement) return NextResponse.json({ error: placement.error }, { status: 400 })
    Object.assign(update, placement.values)
  }

  // Back to the position found from the artwork's rule.
  if (b.reset === true && !art && existing) {
    const t = await loadDefaultBadgeTemplate(db, theme, existing.id)
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
    ? await db.from('default_badge_templates').update(update).eq('id', existing.id).select('id').single()
    : await db.from('default_badge_templates').insert({ ...update, theme, format, audience }).select('id').single()
  if (error || !saved) {
    console.error('[default badge templates] save error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, lineFound, template: await loadDefaultBadgeTemplate(db, theme, saved.id) })
}

// DELETE ?id= — events without their own background for that slot fall back
// to the next one down (mentors → everyone → plain).
export async function DELETE(req: Request, { params }: Ctx) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { theme } = await params
  if (!isArtworkTheme(theme)) return NextResponse.json({ error: 'Unknown theme' }, { status: 404 })
  const id = new URL(req.url).searchParams.get('id') ?? ''
  const { error } = await supabaseServer().from('default_badge_templates').delete().eq('theme', theme).eq('id', id)
  if (error) {
    console.error('[default badge templates] delete error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
