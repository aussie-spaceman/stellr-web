import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { currentUserIsAdmin } from '@/lib/admin-auth'
import { CertificateArtworkError, generateCertificatesPdf } from '@/lib/event-pdf'
import { EVENT_AWARDS, isAwardType } from '@/lib/event-awards'
import { isArtworkTheme } from '@/lib/artwork-theme'
import { downloadArtwork, loadDefaultTemplate, placementFromParams, placementOf } from '@/lib/event-certificates'

export const dynamic = 'force-dynamic'

// GET ?award=<type>&format=&name=&name_y=&name_max_width=&name_size=
// A theme default with a sample name, shown inline — the event preview
// (/api/admin/events/[slug]/certificate-templates/preview) for the defaults.
export async function GET(req: Request, { params }: { params: Promise<{ theme: string }> }) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { theme } = await params
  if (!isArtworkTheme(theme)) return NextResponse.json({ error: 'Unknown theme' }, { status: 404 })

  const search = new URL(req.url).searchParams
  const award = search.get('award')
  if (!isAwardType(award)) return NextResponse.json({ error: 'Unknown award' }, { status: 400 })
  const format = search.get('format') === 'a4' ? 'a4' : 'us_letter'
  const name = (search.get('name') ?? '').trim().slice(0, 120) || 'Alexandra Montgomery-Whitfield'

  const db = supabaseServer()
  const template = await loadDefaultTemplate(db, theme, award)
  if (!template) return NextResponse.json({ error: `Upload the ${EVENT_AWARDS[award].label} artwork first.` }, { status: 400 })
  const artwork = await downloadArtwork(db, template.artwork_path)
  if (!artwork) return NextResponse.json({ error: 'The artwork could not be loaded. Upload it again.' }, { status: 500 })

  try {
    const pdf = await generateCertificatesPdf([{ name }], format, artwork, placementFromParams(placementOf(template), search))
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${theme}-${award}-preview.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    if (err instanceof CertificateArtworkError) return NextResponse.json({ error: err.message }, { status: 400 })
    throw err
  }
}
