import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from 'pdf-lib'
import { stampPdfDocument } from '@/lib/watermark/pdf'

// Badge + certificate PDF generation (PRD 6.7).
// Badges: 3x4" landscape (user-confirmed size), tiled 2×3 on US Letter for printing.
// Certificates: one per student, US Letter or A4 landscape.

const PT_PER_IN = 72
const BADGE_W = 4 * PT_PER_IN
const BADGE_H = 3 * PT_PER_IN
const LETTER: [number, number] = [8.5 * PT_PER_IN, 11 * PT_PER_IN]
const LETTER_LANDSCAPE: [number, number] = [11 * PT_PER_IN, 8.5 * PT_PER_IN]
const A4_LANDSCAPE: [number, number] = [841.89, 595.28]

export interface BadgePerson {
  firstName: string
  lastName: string
  /** company label for students, role label for adults/mentors */
  subtitle: string
}

export interface Artwork {
  bytes: Uint8Array
  mime: string
}

async function embedArtwork(doc: PDFDocument, artwork: Artwork): Promise<PDFImage | null> {
  try {
    if (artwork.mime === 'image/png') return await doc.embedPng(artwork.bytes)
    if (artwork.mime === 'image/jpeg' || artwork.mime === 'image/jpg') return await doc.embedJpg(artwork.bytes)
  } catch (err) {
    console.error('[event-pdf] artwork embed failed:', err)
  }
  return null
}

function drawCentered(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  centerX: number,
  y: number,
  maxWidth: number
) {
  // Shrink to fit so long names never overflow the badge/certificate
  let fitted = size
  while (fitted > 6 && font.widthOfTextAtSize(text, fitted) > maxWidth) fitted -= 0.5
  page.drawText(text, {
    x: centerX - font.widthOfTextAtSize(text, fitted) / 2,
    y,
    size: fitted,
    font,
    color: rgb(0.1, 0.1, 0.15),
  })
}

export async function generateBadgesPdf(
  people: BadgePerson[],
  eventTitle: string,
  artwork: Artwork | null
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const image = artwork ? await embedArtwork(doc, artwork) : null

  const perRow = 2
  const perCol = 3
  const perPage = perRow * perCol
  const [pageW, pageH] = LETTER
  const marginX = (pageW - perRow * BADGE_W) / 2
  const marginY = (pageH - perCol * BADGE_H) / 2

  for (let i = 0; i < people.length; i += perPage) {
    const page = doc.addPage(LETTER)
    const batch = people.slice(i, i + perPage)
    batch.forEach((person, j) => {
      const col = j % perRow
      const row = Math.floor(j / perRow)
      const x = marginX + col * BADGE_W
      const y = pageH - marginY - (row + 1) * BADGE_H

      if (image) {
        page.drawImage(image, { x, y, width: BADGE_W, height: BADGE_H })
      }
      // Cut guide
      page.drawRectangle({
        x,
        y,
        width: BADGE_W,
        height: BADGE_H,
        borderColor: rgb(0.8, 0.8, 0.8),
        borderWidth: 0.5,
      })

      const centerX = x + BADGE_W / 2
      const maxWidth = BADGE_W - 24
      drawCentered(page, person.firstName, bold, 26, centerX, y + BADGE_H - 78, maxWidth)
      drawCentered(page, person.lastName, bold, 20, centerX, y + BADGE_H - 104, maxWidth)
      drawCentered(page, person.subtitle, regular, 13, centerX, y + 46, maxWidth)
      drawCentered(page, eventTitle, regular, 9, centerX, y + 20, maxWidth)
    })
  }

  await stampPdfDocument(doc)
  return doc.save()
}

export async function generateCertificatesPdf(
  students: { firstName: string; lastName: string }[],
  eventTitle: string,
  format: 'us_letter' | 'a4',
  artwork: Artwork | null
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique)
  const image = artwork ? await embedArtwork(doc, artwork) : null

  const size = format === 'a4' ? A4_LANDSCAPE : LETTER_LANDSCAPE
  const [pageW, pageH] = size

  for (const student of students) {
    const page = doc.addPage(size)
    if (image) {
      page.drawImage(image, { x: 0, y: 0, width: pageW, height: pageH })
    } else {
      page.drawRectangle({
        x: 24,
        y: 24,
        width: pageW - 48,
        height: pageH - 48,
        borderColor: rgb(0.3, 0.33, 0.85),
        borderWidth: 2,
      })
    }

    const centerX = pageW / 2
    const maxWidth = pageW - 160
    drawCentered(page, 'Certificate of Participation', regular, 22, centerX, pageH - 150, maxWidth)
    drawCentered(page, `${student.firstName} ${student.lastName}`, bold, 44, centerX, pageH / 2 + 10, maxWidth)
    drawCentered(page, 'participated in', italic, 14, centerX, pageH / 2 - 40, maxWidth)
    drawCentered(page, eventTitle, bold, 24, centerX, pageH / 2 - 78, maxWidth)
  }

  await stampPdfDocument(doc)
  return doc.save()
}
