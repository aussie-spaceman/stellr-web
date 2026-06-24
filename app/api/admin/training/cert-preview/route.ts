import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, signedDownloadUrl } from '@/lib/community'
import { courseIssuer, type MaterialKind, type CourseTheme } from '@/lib/training-display'
import { renderCertificatePdf } from '@/lib/certificate'

// GET /api/admin/training/cert-preview?moduleId=
// Admin-only sample certificate for a course, so the admin can verify how the
// member/course fields land on an uploaded template before going live.
async function requireAdmin() {
  const { sessionClaims } = await auth()
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'
}

export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const moduleId = new URL(req.url).searchParams.get('moduleId')
  if (!moduleId) return NextResponse.json({ error: 'moduleId required' }, { status: 400 })

  const db = supabaseServer()
  const { data: mod } = await db
    .from('training_modules')
    .select('title, theme, material_kind, cert_template_path')
    .eq('id', moduleId)
    .maybeSingle()
  if (!mod) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const admin = await getCurrentMember()
  const templatePath = (mod.cert_template_path as string | null) ?? null
  let templateBytes: ArrayBuffer | null = null
  if (templatePath) {
    const url = await signedDownloadUrl(templatePath)
    if (url) templateBytes = await fetch(url).then((r) => r.arrayBuffer())
  }

  const out = await renderCertificatePdf({
    memberName: [admin?.first_name, admin?.last_name].filter(Boolean).join(' ') || 'Sample Member',
    courseTitle: (mod.title as string) ?? 'Course',
    theme: (mod.theme as CourseTheme | null) ?? null,
    issuer: courseIssuer((mod.material_kind as MaterialKind) ?? 'general'),
    certNumber: 'PREVIEW',
    issuedOn: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    templateBytes,
  })

  return new NextResponse(Buffer.from(out), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="certificate-preview.pdf"' },
  })
}
