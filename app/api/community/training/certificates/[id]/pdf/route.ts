import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, signedDownloadUrl } from '@/lib/community'
import { courseIssuer, type MaterialKind, type CourseTheme } from '@/lib/training-display'
import { renderCertificatePdf } from '@/lib/certificate'

// GET /api/community/training/certificates/[id]/pdf
// Streams the member's completion certificate (default design, or their details
// overlaid on the course's uploaded template). See lib/certificate.ts.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const db = supabaseServer()
  const { data: cert } = await db
    .from('training_certificates')
    .select('id, member_id, cert_number, issuer, issued_at, training_modules(title, theme, material_kind, cert_template_path)')
    .eq('id', id)
    .maybeSingle()

  if (!cert || cert.member_id !== member.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const mod = Array.isArray(cert.training_modules) ? cert.training_modules[0] : cert.training_modules
  const templatePath = (mod?.cert_template_path as string | null) ?? null
  let templateBytes: ArrayBuffer | null = null
  if (templatePath) {
    const url = await signedDownloadUrl(templatePath)
    if (url) templateBytes = await fetch(url).then((r) => r.arrayBuffer())
  }

  const out = await renderCertificatePdf({
    memberName: [member.first_name, member.last_name].filter(Boolean).join(' ') || 'Member',
    courseTitle: (mod?.title as string) ?? 'Course',
    theme: (mod?.theme as CourseTheme | null) ?? null,
    issuer: (cert.issuer as string) ?? courseIssuer((mod?.material_kind as MaterialKind) ?? 'general'),
    certNumber: cert.cert_number as string,
    issuedOn: new Date(cert.issued_at as string).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    templateBytes,
  })

  return new NextResponse(Buffer.from(out), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="stellr-certificate-${cert.cert_number}.pdf"`,
    },
  })
}
