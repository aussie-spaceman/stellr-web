import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, signedDownloadUrl } from '@/lib/community'
import { getCredentialByNumber, recordCredentialEvent } from '@/lib/credentials'
import { renderCredentialPdf } from '@/lib/credential-pdf'
import { certificateGateFor } from '@/lib/survey/certificate-gate'
import { runAfterResponse } from '@/lib/after-response'
import { recordOnHost, recordTenant } from '@/lib/tenancy/host-record'
import { withAudit } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'

// GET /api/credentials/[number]/pdf
// Streams the owner's certificate for a credential (lib/credential-pdf.ts
// draws it). Owner-only: a verifier gets
// the page, not the file. Private credentials download too; consent gates
// publishing, not the holder's own copy.
//
// Survey gate (handover D1, per event, default off): while the event's survey
// is open and the holder has an unsubmitted invitation, the event certificate
// waits for the survey. A browser is sent back to Credentials, which explains
// and links to the survey; anything else gets 403 with the survey link.
//
// Another host's credential answers as one the caller does not hold, before the owner
// check (S5 A10a). A download records a 'pdf' credential event, so it is audited as the
// signed-in user, on the credential's tenant's chain.
export const GET = withAudit(
  ({ args: [req] }) => ({ action: 'credential.pdf.read', ...auditSubject(req, 'credentials'), actor: { session: true } }),
  downloadCredentialPdf,
)

async function downloadCredentialPdf(req: Request, { params }: { params: Promise<{ number: string }> }) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { number } = await params
  const db = supabaseServer()
  const cred = await getCredentialByNumber(db, number)
  if (!cred || !(await recordOnHost(cred)) || cred.owner_member_id !== member.id || cred.tombstoned_at) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  noteAuditSubject(req, { tenantId: recordTenant(cred.tenant_id), id: cred.id })
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

  let courseTemplateBytes: ArrayBuffer | null = null
  if (cred.module_id) {
    const { data: mod } = await db
      .from('training_modules')
      .select('cert_template_path')
      .eq('id', cred.module_id)
      .maybeSingle()
    const templatePath = (mod?.cert_template_path as string | null) ?? null
    if (templatePath) {
      const url = await signedDownloadUrl(templatePath)
      if (url) courseTemplateBytes = await fetch(url).then((r) => r.arrayBuffer())
    }
  }

  const out = await renderCredentialPdf(db, cred, { courseTemplateBytes })
  // deep review QUAL-1: register the audit write with after() so it survives
  // the response flush rather than being dropped on a frozen instance.
  runAfterResponse('credentials', () => recordCredentialEvent(db, cred.id, 'pdf'))
  return pdfResponse(out)
}
