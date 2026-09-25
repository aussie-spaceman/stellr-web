import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
import { CertificateArtworkError, generateCertificatesPdf } from '@/lib/event-pdf'
import { EVENT_AWARDS, isAwardType } from '@/lib/event-awards'
import { downloadArtwork, loadTemplate, placementFromParams, placementOf } from '@/lib/event-certificates'

export const dynamic = 'force-dynamic'

// GET ?award=<type>&format=&name=&name_y=&name_max_width=&name_size=
// One page with a sample name, shown inline — so an admin can see where the
// name lands (and how a long one shrinks) before printing a stack. Unsaved
// slider values ride along as query params and override the stored ones.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const search = new URL(req.url).searchParams
  const award = search.get('award')
  if (!isAwardType(award)) return NextResponse.json({ error: 'Unknown award' }, { status: 400 })
  const format = search.get('format') === 'a4' ? 'a4' : 'us_letter'
  const name = (search.get('name') ?? '').trim().slice(0, 120) || 'Alexandra Montgomery-Whitfield'

  const db = supabaseServer()
  const template = await loadTemplate(db, slug, award)
  if (!template) return NextResponse.json({ error: `Upload the ${EVENT_AWARDS[award].label} artwork first.` }, { status: 400 })
  const artwork = await downloadArtwork(db, template.artwork_path)
  if (!artwork) return NextResponse.json({ error: 'The artwork could not be loaded. Upload it again.' }, { status: 500 })

  try {
    const pdf = await generateCertificatesPdf([{ name }], format, artwork, placementFromParams(placementOf(template), search))
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${slug}-${award}-preview.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    if (err instanceof CertificateArtworkError) return NextResponse.json({ error: err.message }, { status: 400 })
    throw err
  }
}
