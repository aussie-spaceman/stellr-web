import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { currentUserIsAdmin } from '@/lib/admin-auth'
import { PdCertificateArtworkError, parsePdLayout, renderPdCertificatePdf } from '@/lib/pd-certificate'
import { loadPdArtwork, loadPdLayout, pdTheme } from '@/lib/pd-certificate-store'
import { pdStandardCodes } from '@/lib/pd-standards'

export const dynamic = 'force-dynamic'

// GET ?theme=&name=&layout=<json> — a sample PD certificate, inline, on the current
// artwork. Unsaved positions from the positioner ride along as `layout` and
// override the saved ones, so an admin sees where each field lands before saving.
export async function GET(req: Request) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const search = new URL(req.url).searchParams
  const theme = pdTheme(search.get('theme'))
  const db = supabaseServer()
  const [artwork, saved] = await Promise.all([loadPdArtwork(db, theme), loadPdLayout(db, theme)])
  let layout = saved
  const raw = search.get('layout')
  if (raw) {
    try { layout = parsePdLayout(JSON.parse(raw)) ?? saved } catch { /* keep the saved layout */ }
  }
  try {
    const pdf = await renderPdCertificatePdf(
      {
        recipientName: (search.get('name') ?? '').trim().slice(0, 120) || 'Alexandra Montgomery-Whitfield',
        hours: 7.5,
        eventTitle: 'Sample Event',
        activityDate: '2026-10-03',
        activityLocation: 'STEM School, Highlands Ranch, Colorado',
        standards: pdStandardCodes(),
        number: 'STL-2026-7K3MQ8ZD',
        verifyUrl: 'stellreducation.org/credentials/STL-2026-7K3MQ8ZD',
        issuer: 'Stellr Education',
      },
      artwork,
      { layout },
    )
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="pd-certificate-preview.pdf"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    if (err instanceof PdCertificateArtworkError) return NextResponse.json({ error: err.message }, { status: 400 })
    throw err
  }
}
