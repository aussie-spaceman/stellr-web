import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, signedDownloadUrl } from '@/lib/community'
import { type CourseTheme } from '@/lib/training-display'
import { renderCertificatePdf } from '@/lib/certificate'
import { credentialUrl, getCredentialByNumber, recordCredentialEvent } from '@/lib/credentials'
import { generateCertificatesPdf } from '@/lib/event-pdf'
import { EVENT_AWARDS, isAwardType } from '@/lib/event-awards'
import { downloadArtwork, loadTemplate, placementOf } from '@/lib/event-certificates'
import { certificateGateFor } from '@/lib/survey/certificate-gate'
import { renderPdCertificatePdf } from '@/lib/pd-certificate'
import { loadPdArtwork, loadPdLayout, pdTheme } from '@/lib/pd-certificate-store'
import { tokens } from '@/lib/tokens'

// GET /api/credentials/[number]/pdf
// Streams the owner's certificate for a credential. An event credential prints
// on that event's artwork for its award — the same page the admin prints for
// the ceremony (lib/event-pdf.ts). A course credential uses the default design
// or the course's template (lib/certificate.ts). Owner-only: a verifier gets
// the page, not the file. Private credentials download too; consent gates
// publishing, not the holder's own copy.
//
// Survey gate (handover D1, per event, default off): while the event's survey
// is open and the holder has an unsubmitted invitation, the event certificate
// waits for the survey. A browser is sent back to Credentials, which explains
// and links to the survey; anything else gets 403 with the survey link.
export async function GET(req: Request, { params }: { params: Promise<{ number: string }> }) {
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

  const gate = await certificateGateFor(db, member.id, cred)
  if (gate.gated) {
    if ((req.headers.get('accept') ?? '').includes('text/html')) {
      return NextResponse.redirect(new URL(`/community/credentials?survey_first=${encodeURIComponent(cred.number)}`, req.url), 303)
    }
    return NextResponse.json(
      { error: `Finish the ${gate.eventTitle} survey to download this certificate.`, surveyUrl: gate.surveyUrl },
      { status: 403 },
    )
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

  // Educator PD: the theme's Cowork front with its four fields drawn, then the
  // back; or the plain page until that theme has artwork. Never survey-gated.
  if (cred.source === 'pd' && cred.pd_hours) {
    const theme = pdTheme(cred.theme)
    const [artwork, layout] = await Promise.all([loadPdArtwork(db, theme), loadPdLayout(db, theme)])
    const out = await renderPdCertificatePdf(
      {
        recipientName:    cred.recipient_name || 'Educator',
        hours:            Number(cred.pd_hours),
        eventTitle:       cred.activity_title ?? cred.title,
        activityDate:     cred.activity_date,
        activityLocation: cred.activity_location,
        standards:        cred.standards,
        number:           cred.number,
        verifyUrl:        credentialUrl(cred.number).replace(/^https?:\/\//, ''),
        issuer:           cred.issuer,
      },
      artwork,
      { accentHex: cred.theme === 'environmental' ? tokens.color.enviroGreen : tokens.color.spaceViolet, layout },
    )
    void recordCredentialEvent(db, cred.id, 'pdf')
    return pdfResponse(out)
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

  const event = cred.source === 'event' ? eventHeading(cred.award_type) : null
  const out = await renderCertificatePdf({
    memberName:  cred.recipient_name || 'Member',
    courseTitle: cred.title,
    heading:     event?.heading,
    lead:        event?.lead,
    theme:       (cred.theme as CourseTheme | null) ?? null,
    issuer:      cred.issuer,
    certNumber:  cred.number,
    issuedOn:    new Date(cred.issued_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    templateBytes,
  })

  void recordCredentialEvent(db, cred.id, 'pdf')
  return pdfResponse(out)
}

/** The default design's wording for an event credential with no artwork. */
function eventHeading(awardType: string | null): { heading: string; lead: string } {
  if (awardType === 'mentor') return { heading: EVENT_AWARDS.mentor.label, lead: 'with thanks for their service as' }
  if (awardType && awardType !== 'participation') return { heading: 'Certificate of Award', lead: 'has been awarded' }
  return { heading: 'Certificate of Participation', lead: 'took part in' }
}
