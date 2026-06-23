import { NextResponse } from 'next/server'
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, signedDownloadUrl } from '@/lib/community'
import { THEME_META, type CourseTheme } from '@/lib/training'

// GET /api/community/training/certificates/[id]/pdf
// Streams the member's completion certificate. If the course has an uploaded
// certificate template (cert_template_path), we overlay the member/course details
// onto it; otherwise a default Stellr certificate is generated from scratch.

function hexToRgb(hex: string) {
  const h = hex.replace('#', '')
  return rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255
  )
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const db = supabaseServer()
  const { data: cert } = await db
    .from('training_certificates')
    .select('id, member_id, cert_number, issuer, issued_at, training_modules(title, theme, cert_template_path)')
    .eq('id', id)
    .maybeSingle()

  // Members can only download their own certificates.
  if (!cert || cert.member_id !== member.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const mod = Array.isArray(cert.training_modules) ? cert.training_modules[0] : cert.training_modules
  const courseTitle = (mod?.title as string) ?? 'Course'
  const theme = (mod?.theme as CourseTheme | null) ?? null
  const accentHex = theme ? THEME_META[theme].color : '#3C6DF6'
  const templatePath = (mod?.cert_template_path as string | null) ?? null
  const memberName = [member.first_name, member.last_name].filter(Boolean).join(' ') || 'Member'
  const issuedOn = new Date(cert.issued_at as string).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  let pdf: PDFDocument
  let page

  if (templatePath) {
    // Overlay onto the uploaded template's first page.
    const url = await signedDownloadUrl(templatePath)
    const bytes = url ? await fetch(url).then((r) => r.arrayBuffer()) : null
    if (bytes) {
      pdf = await PDFDocument.load(bytes)
      page = pdf.getPages()[0]
    } else {
      pdf = await PDFDocument.create()
      page = pdf.addPage([792, 612])
    }
  } else {
    pdf = await PDFDocument.create()
    page = pdf.addPage([792, 612]) // US Letter landscape
  }

  const { width, height } = page.getSize()
  const helv = await pdf.embedFont(StandardFonts.Helvetica)
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const accent = hexToRgb(accentHex)
  const ink = rgb(0.055, 0.075, 0.188) // #0E1330
  const muted = rgb(0.35, 0.38, 0.47)

  const center = (text: string, font: typeof helv, size: number, y: number, color = ink) => {
    const w = font.widthOfTextAtSize(text, size)
    page.drawText(text, { x: (width - w) / 2, y, size, font, color })
  }

  // Default certificate decoration (skipped when overlaying a template, which
  // carries its own design — we only stamp the dynamic fields there).
  if (!templatePath) {
    page.drawRectangle({ x: 0, y: height - 14, width, height: 14, color: accent })
    page.drawRectangle({ x: 0, y: 0, width, height: 14, color: accent })
    center('STELLR EDUCATION', helvBold, 13, height - 70, accent)
    center('Certificate of Completion', helvBold, 30, height - 150, ink)
    center('This certifies that', helv, 13, height - 200, muted)
    center(memberName, helvBold, 26, height - 245, ink)
    center('has successfully completed', helv, 13, height - 290, muted)
    center(courseTitle, helvBold, 20, height - 330, accent)
    center(`Issued ${issuedOn} · ${cert.issuer}`, helv, 12, 120, muted)
    center(`Certificate No. ${cert.cert_number}`, helv, 11, 100, muted)
  } else {
    // Stamp the dynamic fields low on the template page.
    center(memberName, helvBold, 22, height * 0.42, ink)
    center(courseTitle, helvBold, 16, height * 0.42 - 36, accent)
    page.drawText(`Issued ${issuedOn} · ${cert.issuer}  ·  No. ${cert.cert_number}`, {
      x: 48,
      y: 40,
      size: 9,
      font: helv,
      color: muted,
      rotate: degrees(0),
    })
  }

  const out = await pdf.save()
  return new NextResponse(Buffer.from(out), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="stellr-certificate-${cert.cert_number}.pdf"`,
    },
  })
}
