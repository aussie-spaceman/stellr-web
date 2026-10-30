import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { currentUserIsAdmin } from '@/lib/admin-auth'
import { isAwardType } from '@/lib/event-awards'
import { isArtworkTheme } from '@/lib/artwork-theme'
import { CERTIFICATE_PLACEMENT_RANGES, claimArtwork, placementInput } from '@/lib/artwork-template-input'
import { loadDefaultTemplate, loadDefaultTemplates, pinDefaultCertificate } from '@/lib/event-certificates'

export const dynamic = 'force-dynamic'

// A theme's default certificate artwork, one per award: what every event of
// that theme prints unless it uploads its own (lib/artwork-defaults.ts).
// Admins only. Mirrors /api/admin/events/[slug]/certificate-templates.
//   GET                                       → { theme, templates }
//   PUT { awardType, storagePath?, fileType?, name_y?, name_max_width?, name_size? }
//   DELETE ?awardType=
// Replacing or removing a default's artwork first pins the outgoing one to
// every event that has issued that award on it (pinDefaultCertificate).

type Ctx = { params: Promise<{ theme: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { theme } = await params
  if (!isArtworkTheme(theme)) return NextResponse.json({ error: 'Unknown theme' }, { status: 404 })
  return NextResponse.json({ theme, templates: await loadDefaultTemplates(supabaseServer(), theme) })
}

export async function PUT(req: Request, { params }: Ctx) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { theme } = await params
  if (!isArtworkTheme(theme)) return NextResponse.json({ error: 'Unknown theme' }, { status: 404 })

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const awardType = b.awardType
  if (!isAwardType(awardType)) return NextResponse.json({ error: 'awardType is required' }, { status: 400 })

  const db = supabaseServer()
  const update: Record<string, unknown> = { theme, award_type: awardType }

  const art = await claimArtwork(b, 'artwork-default', `artwork-defaults/${theme}/certificate-${awardType}-`)
  if (art && 'error' in art) return NextResponse.json({ error: art.error }, { status: art.status })
  if (art) update.artwork_path = art.path

  const placement = placementInput(b, CERTIFICATE_PLACEMENT_RANGES)
  if ('error' in placement) return NextResponse.json({ error: placement.error }, { status: 400 })
  Object.assign(update, placement.values)

  const existing = await loadDefaultTemplate(db, theme, awardType)
  if (!existing && !update.artwork_path) {
    return NextResponse.json({ error: 'Upload the artwork before positioning the name.' }, { status: 400 })
  }

  // New artwork: events that issued this award on the old one keep it.
  if (existing && art) {
    try {
      await pinDefaultCertificate(db, theme, existing)
    } catch (err) {
      console.error('[default certificate templates] pin failed:', err)
      return NextResponse.json(
        { error: 'Events that already issued this certificate could not keep their artwork, so it was not replaced. Try again.' },
        { status: 500 },
      )
    }
  }

  // A placement-only save must be an update (see the event route).
  const { error } = existing
    ? await db.from('default_certificate_templates').update(update).eq('theme', theme).eq('award_type', awardType)
    : await db.from('default_certificate_templates').upsert(update, { onConflict: 'theme,award_type' })
  if (error) {
    console.error('[default certificate templates] save error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, template: await loadDefaultTemplate(db, theme, awardType) })
}

export async function DELETE(req: Request, { params }: Ctx) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { theme } = await params
  if (!isArtworkTheme(theme)) return NextResponse.json({ error: 'Unknown theme' }, { status: 404 })
  const awardType = new URL(req.url).searchParams.get('awardType')
  if (!isAwardType(awardType)) return NextResponse.json({ error: 'awardType is required' }, { status: 400 })

  const db = supabaseServer()
  const existing = await loadDefaultTemplate(db, theme, awardType)
  if (!existing) return NextResponse.json({ ok: true })
  try {
    await pinDefaultCertificate(db, theme, existing)
  } catch (err) {
    console.error('[default certificate templates] pin failed:', err)
    return NextResponse.json(
      { error: 'Events that already issued this certificate could not keep their artwork, so it was not removed. Try again.' },
      { status: 500 },
    )
  }
  const { error } = await db.from('default_certificate_templates').delete().eq('theme', theme).eq('award_type', awardType)
  if (error) {
    console.error('[default certificate templates] delete error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
