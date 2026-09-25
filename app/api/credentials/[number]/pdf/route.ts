import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, signedDownloadUrl } from '@/lib/community'
import { type CourseTheme } from '@/lib/training-display'
import { renderCertificatePdf } from '@/lib/certificate'
import { getCredentialByNumber, recordCredentialEvent } from '@/lib/credentials'
import { generateCertificatesPdf } from '@/lib/event-pdf'
import { isAwardType } from '@/lib/event-awards'
import { downloadArtwork, loadTemplate, placementOf } from '@/lib/event-certificates'

// GET /api/credentials/[number]/pdf
// Streams the owner's certificate for a credential. An event credential prints
// on that event's artwork for its award — the same page the admin prints for
// the ceremony (lib/event-pdf.ts). A course credential uses the default design
// or the course's template (lib/certificate.ts). Owner-only: a verifier gets
// the page, not the file. Private credentials download too; consent gates
// publishing, not the holder's own copy.
export async function GET(_req: Request, { params }: { params: Promise<{ number: string }> }) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { number } = await params
  const db = supabaseServer()
  const cred = await getCredentialByNumber(db, number)
  if (!cred || cred.owner_member_id !== member.id || cred.tombstoned_at) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  // An award the judges took back leaves no certificate to print.
  if (cred.status === 'revoked') {
    return NextResponse.json({ error: 'This credential has been revoked.' }, { status: 410 })
  }

  const filename = `stellr-credential-${cred.number}.pdf`
  const pdfResponse = (bytes: Uint8Array) =>
    new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })

  if (cred.source === 'event' && cred.event_slug && isAwardType(cred.award_type)) {
    const template = await loadTemplate(db, cred.event_slug, cred.award_type)
    const artwork = template ? await downloadArtwork(db, template.artwork_path) : null
    if (template && artwork) {
      const out = await generateCertificatesPdf([{ name: cred.recipient_name || 'Member' }], 'us_letter', artwork, placementOf(template))
      void recordCredentialEvent(db, cred.id, 'pdf')
      return pdfResponse(out)
    }
    // No artwork for this award yet: fall through to the default design.
  }

  let templateBytes: ArrayBuffer | null = null
  if (cred.module_id) {
    const { data: mod } = await db
      .from('training_modules')
      .select('cert_template_path')
      .eq('id', cred.module_id)
      .maybeSingle()
    const templatePath = (mod?.cert_template_path as string | null) ?? null
    if (templatePath) {
      const url = await signedDownloadUrl(templatePath)
      if (url) templateBytes = await fetch(url).then((r) => r.arrayBuffer())
    }
  }

  const out = await renderCertificatePdf({
    memberName:  cred.recipient_name || 'Member',
    courseTitle: cred.title,
    heading:     cred.source === 'event' ? (cred.award_type && cred.award_type !== 'participation' ? 'Certificate of Award' : 'Certificate of Participation') : undefined,
    lead:        cred.source === 'event' ? (cred.award_type && cred.award_type !== 'participation' ? 'has been awarded' : 'took part in') : undefined,
    theme:       (cred.theme as CourseTheme | null) ?? null,
    issuer:      cred.issuer,
    certNumber:  cred.number,
    issuedOn:    new Date(cred.issued_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    templateBytes,
  })

  void recordCredentialEvent(db, cred.id, 'pdf')
  return pdfResponse(out)
}
