import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, signedDownloadUrl } from '@/lib/community'
import { type CourseTheme } from '@/lib/training-display'
import { renderCertificatePdf } from '@/lib/certificate'
import { getCredentialByNumber, recordCredentialEvent } from '@/lib/credentials'

// GET /api/credentials/[number]/pdf
// Streams the owner's certificate for a credential (default design, or their
// details overlaid on the course's uploaded template). Owner-only: a verifier
// gets the page, not the file. See lib/certificate.ts.
export async function GET(_req: Request, { params }: { params: Promise<{ number: string }> }) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { number } = await params
  const db = supabaseServer()
  const cred = await getCredentialByNumber(db, number)
  if (!cred || cred.member_id !== member.id || cred.tombstoned_at) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
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
    theme:       (cred.theme as CourseTheme | null) ?? null,
    issuer:      cred.issuer,
    certNumber:  cred.number,
    issuedOn:    new Date(cred.issued_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    templateBytes,
  })

  void recordCredentialEvent(db, cred.id, 'pdf')

  return new NextResponse(Buffer.from(out), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="stellr-credential-${cred.number}.pdf"`,
    },
  })
}
