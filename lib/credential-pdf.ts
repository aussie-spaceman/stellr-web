import type { SupabaseClient } from '@supabase/supabase-js'
import { type CourseTheme } from '@/lib/training-display'
import { renderCertificatePdf } from '@/lib/certificate'
import { credentialUrl, type CredentialView } from '@/lib/credentials'
import { generateCertificatesPdf } from '@/lib/event-pdf'
import { EVENT_AWARDS, artworkSupersededFor, isAwardType } from '@/lib/event-awards'
import { downloadArtwork, loadTemplate, placementOf } from '@/lib/event-certificates'
import { renderPdCertificatePdf } from '@/lib/pd-certificate'
import { loadPdArtwork, loadPdLayout, pdTheme } from '@/lib/pd-certificate-store'
import { tokens } from '@/lib/tokens'

// The certificate PDF for one credential. Shared by the holder's download
// (app/api/credentials/[number]/pdf) and the family link from an event email
// (app/(stellr)/(public)/credentials/[number]/certificate), so both print the
// same page. An event credential prints on that event's artwork for its award,
// else its theme's default — the same page the admin prints for the ceremony
// (lib/event-pdf.ts). A course credential uses the default design or the
// course's template (lib/certificate.ts), which the caller reads and passes in
// (keeping lib/community out of the family link's reach).
export async function renderCredentialPdf(
  db: SupabaseClient,
  cred: CredentialView,
  opts: { courseTemplateBytes?: ArrayBuffer | null } = {},
): Promise<Uint8Array> {
  // A renamed award's uploaded artwork still prints its earlier name, so it
  // uses the default design until new artwork replaces it.
  if (cred.source === 'event' && cred.event_slug && isAwardType(cred.award_type) && !artworkSupersededFor(cred.award_type)) {
    const template = await loadTemplate(db, cred.event_slug, cred.award_type, pdTheme(cred.theme ?? cred.event_slug))
    const artwork = template ? await downloadArtwork(db, template.artwork_path) : null
    if (template && artwork) {
      const out = await generateCertificatesPdf([{ name: cred.recipient_name || 'Member' }], 'us_letter', artwork, placementOf(template))
      return out
    }
    // No artwork for this award yet: fall through to the default design.
  }

  // Educator PD: the event's own Cowork pages, else its theme's, with the four
  // fields drawn on the front; or the plain page until there is a front. Never
  // survey-gated.
  if (cred.source === 'pd' && cred.pd_hours) {
    const theme = pdTheme(cred.theme)
    const [artwork, layout] = await Promise.all([
      loadPdArtwork(db, theme, cred.event_slug),
      loadPdLayout(db, theme, cred.event_slug),
    ])
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
    return out
  }

  // A course credential's own template, when the caller found one (the
  // holder's download does; the event-email family link never needs it).
  const templateBytes = opts.courseTemplateBytes ?? null

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

  return out
}


/** The default design's wording for an event credential with no artwork. */
function eventHeading(awardType: string | null): { heading: string; lead: string } {
  if (awardType === 'mentor') return { heading: EVENT_AWARDS.mentor.label, lead: 'with thanks for their service as' }
  if (awardType && awardType !== 'participation') return { heading: 'Certificate of Award', lead: 'has been awarded' }
  return { heading: 'Certificate of Participation', lead: 'took part in' }
}
