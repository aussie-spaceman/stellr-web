import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { currentUserIsAdmin } from '@/lib/admin-auth'
import { downloadArtwork } from '@/lib/event-certificates'
import { PD_ARTWORK_PATH, PdCertificateArtworkError, renderPdCertificatePdf } from '@/lib/pd-certificate'
import { pdStandardCodes } from '@/lib/pd-standards'

export const dynamic = 'force-dynamic'

// GET — one sample PD certificate, inline: the current artwork (or the plain
// fallback) with long sample values, so field placement can be checked before
// anything is issued.
export async function GET() {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const artwork = await downloadArtwork(supabaseServer(), PD_ARTWORK_PATH)
  try {
    const pdf = await renderPdCertificatePdf(
      {
        recipientName: 'Alexandra Montgomery-Whitfield',
        hours: 7.5,
        eventTitle: 'Sample Event — A Long Competition Name, Colorado 2026',
        activityDate: '2026-10-04',
        activityLocation: 'Sample Venue High School, Springfield, CO',
        standards: pdStandardCodes(),
        number: 'STL-2026-7K3MQ8ZD',
        verifyUrl: 'stellreducation.org/credentials/STL-2026-7K3MQ8ZD',
        issuer: 'Stellr Education',
      },
      artwork,
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
