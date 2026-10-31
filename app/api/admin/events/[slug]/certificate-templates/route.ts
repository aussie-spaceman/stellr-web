import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
import { isAwardType } from '@/lib/event-awards'
import { eventArtworkTheme } from '@/lib/artwork-defaults'
import { CERTIFICATE_PLACEMENT_RANGES, claimArtwork, placementInput } from '@/lib/artwork-template-input'
import { loadDefaultTemplates, loadEventTemplate, loadEventTemplates } from '@/lib/event-certificates'

export const dynamic = 'force-dynamic'

// Certificate artwork, one per award. GET lists the event's own templates and
// its theme's defaults, which stand in for any award without one; PUT replaces
// the event's artwork (a path already uploaded browser → storage via
// /api/uploads/sign, kind certificate-<award>) and/or moves the name; DELETE
// drops the event's own artwork, so that award prints the default again.

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const db = supabaseServer()
  const theme = await eventArtworkTheme(slug)
  const [templates, defaults] = await Promise.all([loadEventTemplates(db, slug), loadDefaultTemplates(db, theme)])
  return NextResponse.json({ theme, templates, defaults })
}

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

  const art = await claimArtwork(b, 'event-artwork', `event-artwork/${slug}/certificate-${awardType}-`)
  if (art && 'error' in art) return NextResponse.json({ error: art.error }, { status: art.status })
  if (art) update.artwork_path = art.path

  const placement = placementInput(b, CERTIFICATE_PLACEMENT_RANGES)
  if ('error' in placement) return NextResponse.json({ error: placement.error }, { status: 400 })
  Object.assign(update, placement.values)

  const existing = await loadEventTemplate(db, slug, awardType)
  if (!existing && !update.artwork_path) {
    return NextResponse.json({ error: 'Upload the artwork before positioning the name.' }, { status: 400 })
  }

  // Postgres checks NOT NULL on the row an upsert would insert before it finds
  // the conflict, so a placement-only save (no artwork_path) must be an update.
  const { error } = existing
    ? await db.from('event_certificate_templates').update(update).eq('event_slug', slug).eq('award_type', awardType)
    : await db.from('event_certificate_templates').upsert(update, { onConflict: 'event_slug,award_type' })
  if (error) {
    console.error('[certificate templates] save error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, template: await loadEventTemplate(db, slug, awardType) })
}

// DELETE ?awardType= — the award prints its theme default again (or, with no
// default, the admin print asks for artwork and member downloads use the
// plain design).
export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const awardType = new URL(req.url).searchParams.get('awardType')
  if (!isAwardType(awardType)) return NextResponse.json({ error: 'awardType is required' }, { status: 400 })
  const { error } = await supabaseServer()
    .from('event_certificate_templates')
    .delete()
    .eq('event_slug', slug)
    .eq('award_type', awardType)
  if (error) {
    console.error('[certificate templates] delete error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
