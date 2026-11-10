import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { rateLimit } from '@/lib/rate-limit-async'
import { requestTenant } from '@/lib/tenancy/request-tenant'
import { AUTH_APP_URL } from '@/lib/env'
import { getCredentialByNumber } from '@/lib/credentials'
import { FAMILY_LINK_PARAM, verifyCredentialPdfToken } from '@/lib/credentials-link'
import { renderCredentialPdf } from '@/lib/credential-pdf'
import { certificateGate, type GateDistribution, type GateInvitation } from '@/lib/survey/certificate-gate'

// GET /api/credentials/[number]/certificate?k=<token>
// The certificate PDF from an event email's {{certificate_links}}: the family
// link (lib/credentials-link.ts, familyCertificateUrl). A minor's email goes to
// their parent or guardian, who has no Stellr account, so the holder-only
// /api/credentials/[number]/pdf is closed to them. The token is per credential
// and per purpose; without a valid one this answers 404, so the URL never
// confirms that a credential exists. Rate-limited.
//
// Survey gate (handover D1, per event, default off): while the event's survey
// is open and gates certificates, and the holder was invited and has not
// submitted, the browser is sent to the event's survey page instead.
export async function GET(req: Request, { params }: { params: Promise<{ number: string }> }) {
  const limited = await rateLimit(req, 'credential-certificate', { limit: 20, windowMs: 60_000, tenantId: (await requestTenant()).tenantId })
  if (limited) return limited

  const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { number } = await params
  const token = new URL(req.url).searchParams.get(FAMILY_LINK_PARAM)
  const db = supabaseServer()
  const cred = await getCredentialByNumber(db, decodeURIComponent(number))
  if (!cred || cred.tombstoned_at || !verifyCredentialPdfToken(cred.id, token)) return notFound()
  if (cred.status === 'revoked') return NextResponse.json({ error: 'This credential has been revoked.' }, { status: 410 })

  if (cred.source === 'event' && cred.event_slug && (await surveyFirst(db, cred))) {
    return NextResponse.redirect(`${AUTH_APP_URL}/survey/event/${encodeURIComponent(cred.event_slug)}`, 303)
  }

  // Read-only: unlike the holder's own download, no 'pdf' credential event is
  // recorded, since the person downloading may not be the holder.
  const out = await renderCredentialPdf(db, cred)
  return new NextResponse(Buffer.from(out), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="stellr-certificate-${cred.number}.pdf"`,
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex',
    },
  })
}

/** The D1 gate, for a holder who may have no account: by participant or member. */
async function surveyFirst(
  db: ReturnType<typeof supabaseServer>,
  cred: { event_slug: string | null; participant_id: string | null; owner_member_id: string | null; member_id: string | null },
): Promise<boolean> {
  const { data: dists } = await db
    .from('survey_distributions')
    .select('id, event_slug, event_title, gate_certificate, status, opens_at, closes_at')
    .eq('event_slug', cred.event_slug!)
    .eq('gate_certificate', true)
  if (!dists?.length) return false
  const owners = [
    cred.participant_id && `participant_id.eq.${cred.participant_id}`,
    (cred.owner_member_id ?? cred.member_id) && `member_id.eq.${cred.owner_member_id ?? cred.member_id}`,
  ].filter(Boolean)
  if (!owners.length) return false
  const { data: invs } = await db
    .from('survey_invitations')
    .select('id, distribution_id, status')
    .in('distribution_id', dists.map((d) => d.id as string))
    .or(owners.join(','))
  return certificateGate(cred.event_slug, dists as GateDistribution[], (invs ?? []) as GateInvitation[]).gated
}
