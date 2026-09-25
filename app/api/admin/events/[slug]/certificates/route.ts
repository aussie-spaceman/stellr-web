import { NextResponse } from 'next/server'
import { PDFDocument } from 'pdf-lib'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
import { CertificateArtworkError, generateCertificatesPdf } from '@/lib/event-pdf'
import { markWatermarked } from '@/lib/watermark/pdf'
import { AWARD_TYPES, EVENT_AWARDS, isAwardType, type AwardType } from '@/lib/event-awards'
import {
  downloadArtwork,
  fullName,
  listAssignments,
  listEventCompanies,
  listEventStudents,
  loadTemplates,
  placementOf,
  recipientsFor,
} from '@/lib/event-certificates'

export const dynamic = 'force-dynamic'

// GET /api/admin/events/[slug]/certificates?award=<type>|all&format=us_letter|a4
// Print certificates: each award's artwork with the recipient's name, one page
// each. participation = every student; the judged awards = their assignees
// (draft or issued — printing for the ceremony comes before issuing); all =
// every certificate in one file, award by award.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const search = new URL(req.url).searchParams
  const format = search.get('format') === 'a4' ? 'a4' : 'us_letter'
  const awardParam = search.get('award') ?? 'participation'
  if (awardParam !== 'all' && !isAwardType(awardParam)) {
    return NextResponse.json({ error: 'Unknown award' }, { status: 400 })
  }
  const awards: AwardType[] = awardParam === 'all' ? [...AWARD_TYPES] : [awardParam as AwardType]

  const db = supabaseServer()
  const [templates, students, assignments, companies] = await Promise.all([
    loadTemplates(db, slug),
    listEventStudents(db, slug),
    listAssignments(db, slug),
    listEventCompanies(db, slug),
  ])

  const parts: Uint8Array[] = []
  for (const award of awards) {
    const recipients = recipientsFor(award, students, assignments, companies)
    if (recipients.length === 0) continue
    const label = EVENT_AWARDS[award].label
    const template = templates[award]
    if (!template) {
      return NextResponse.json({ error: `Upload the ${label} artwork first.` }, { status: 400 })
    }
    const artwork = await downloadArtwork(db, template.artwork_path)
    if (!artwork) {
      return NextResponse.json({ error: `The ${label} artwork could not be loaded. Upload it again.` }, { status: 500 })
    }
    try {
      parts.push(await generateCertificatesPdf(recipients.map((r) => ({ name: fullName(r) })), format, artwork, placementOf(template)))
    } catch (err) {
      if (err instanceof CertificateArtworkError) return NextResponse.json({ error: err.message }, { status: 400 })
      throw err
    }
  }

  if (parts.length === 0) {
    const none = awardParam === 'participation' || awardParam === 'all'
      ? 'No students to generate certificates for.'
      : `No one has been given the ${EVENT_AWARDS[awardParam as AwardType].label} yet.`
    return NextResponse.json({ error: none }, { status: 400 })
  }

  const pdf = parts.length === 1 ? parts[0] : await merge(parts)
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${slug}-certificates-${awardParam}-${format}.pdf"`,
    },
  })
}

async function merge(parts: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  for (const bytes of parts) {
    const src = await PDFDocument.load(bytes)
    const pages = await out.copyPages(src, src.getPageIndices())
    pages.forEach((p) => out.addPage(p))
  }
  markWatermarked(out)
  return out.save()
}
