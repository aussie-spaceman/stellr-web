import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { THEME_META, type CourseTheme } from '@/lib/training-display'

// Shared certificate PDF renderer — used by the member download
// (/api/community/training/certificates/[id]/pdf) and the admin preview
// (/api/admin/training/cert-preview). When a template PDF is supplied we overlay
// the member/course fields onto it (positioned by page-relative percentages so it
// adapts to the template's size); otherwise a default Stellr certificate is drawn.

function hexToRgb(hex: string) {
  const h = hex.replace('#', '')
  return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255)
}

export interface CertificateInput {
  memberName: string
  courseTitle: string
  theme: CourseTheme | null
  issuer: string
  certNumber: string
  issuedOn: string // pre-formatted date string
  templateBytes?: ArrayBuffer | null
}

export async function renderCertificatePdf(input: CertificateInput): Promise<Uint8Array> {
  const accentHex = input.theme ? THEME_META[input.theme].color : '#3C6DF6'
  const accent = hexToRgb(accentHex)
  const ink = rgb(0.055, 0.075, 0.188) // #0E1330
  const muted = rgb(0.35, 0.38, 0.47)

  let pdf: PDFDocument
  let page
  const usingTemplate = !!input.templateBytes
  if (input.templateBytes) {
    pdf = await PDFDocument.load(input.templateBytes)
    page = pdf.getPages()[0] ?? pdf.addPage([792, 612])
  } else {
    pdf = await PDFDocument.create()
    page = pdf.addPage([792, 612]) // US Letter landscape
  }

  const { width, height } = page.getSize()
  const helv = await pdf.embedFont(StandardFonts.Helvetica)
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const center = (text: string, font: typeof helv, size: number, y: number, color = ink) => {
    const w = font.widthOfTextAtSize(text, size)
    page.drawText(text, { x: (width - w) / 2, y, size, font, color })
  }

  if (!usingTemplate) {
    page.drawRectangle({ x: 0, y: height - 14, width, height: 14, color: accent })
    page.drawRectangle({ x: 0, y: 0, width, height: 14, color: accent })
    center('STELLR EDUCATION', helvBold, 13, height - 70, accent)
    center('Certificate of Completion', helvBold, 30, height - 150, ink)
    center('This certifies that', helv, 13, height - 200, muted)
    center(input.memberName, helvBold, 26, height - 245, ink)
    center('has successfully completed', helv, 13, height - 290, muted)
    center(input.courseTitle, helvBold, 20, height - 330, accent)
    center(`Issued ${input.issuedOn} · ${input.issuer}`, helv, 12, 120, muted)
    center(`Certificate No. ${input.certNumber}`, helv, 11, 100, muted)
  } else {
    // Page-relative overlay so it tracks the template's dimensions.
    center(input.memberName, helvBold, 22, height * 0.42, ink)
    center(input.courseTitle, helvBold, 16, height * 0.42 - 36, accent)
    center(`Issued ${input.issuedOn} · ${input.issuer}  ·  No. ${input.certNumber}`, helv, 9, height * 0.1, muted)
  }

  return pdf.save()
}
