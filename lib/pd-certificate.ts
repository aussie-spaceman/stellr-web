import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument, type PDFFont, type PDFPage, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { markWatermarked } from '@/lib/watermark/pdf'
import { tokens } from '@/lib/tokens'
import { coverFit, embedArtwork, fittedSize, type Artwork, type Fit } from '@/lib/event-pdf'
import { describeStandard, formatPdHours } from '@/lib/pd-standards'
import { DEFAULT_PD_LAYOUT, PD_DESIGN_HEIGHT, PD_FIELDS, PD_FIELD_FONT, type PdField, type PdLayout } from '@/lib/pd-certificate-layout'

export * from '@/lib/pd-certificate-layout'

// ── Educator PD certificate ──────────────────────────────────────────────────
// Two pages of Cowork artwork (8 Oct 2026, David):
//   front — the design with gaps for four fields, drawn here: the teacher's
//           name (Aileron, shrunk to fit) and the event location, date and
//           hours of effort (Norwester);
//   back  — the standards alignment map, printed as is.
// Field positions are fractions of the FRONT artwork (cover-fitted, as
// lib/event-pdf.ts does) and are set by an admin with the positioner on the
// Educator PD panel, stored as JSON beside the artwork (lib/pd-certificate-store).
//
// Sizes are in the design's own units: the Cowork set is 2000×1500 in Canva, so
// "Norwester 36" in Canva is size 36 here, whatever resolution the PNG was
// exported at. Award certificates use print points instead; these do not.
//
// With no front artwork uploaded, a plain one-page certificate is drawn so a
// credential can still be issued and downloaded.
// Design: docs/PLAN-educator-pd-2026-10-07.md §4, §8.

const LETTER_LANDSCAPE: [number, number] = [792, 612]

export interface PdCertificateFields {
  recipientName: string
  hours: number
  eventTitle: string
  /** YYYY-MM-DD. */
  activityDate: string | null
  activityLocation: string | null
  standards: string[]
  number: string
  /** stellreducation.org/credentials/<number>, scheme stripped. */
  verifyUrl: string
  issuer: string
}

// ── Artwork mode: four fields on the Cowork front ────────────────────────────

/** What each field says. "at" / "on" are part of the field, as in the mock-up. */
export function pdArtworkTexts(f: PdCertificateFields): Record<PdField, string> {
  const date = formatActivityDate(f.activityDate)
  const place = f.activityLocation?.trim()
  return {
    name: f.recipientName.trim() || 'Educator',
    location: place ? `at ${place}` : '',
    date: date ? `on ${date}` : '',
    hours: formatPdHours(f.hours),
  }
}

export type PdSlot = 'name' | 'statement' | 'event' | 'when' | 'ngss' | 'ccss' | 'verify'

export interface SlotPlacement {
  /** Baseline, fraction of artwork height from the top. */
  y: number
  /** Widest the line may run, fraction of artwork width. */
  maxWidth: number
  /** Starting size in points on US Letter; shrinks to fit. */
  size: number
  weight: 'semibold' | 'regular'
  color: 'ink' | 'muted' | 'accent'
}

/** The plain page (no artwork uploaded): every field, at fixed positions. */
export const PD_LAYOUT: Record<PdSlot, SlotPlacement> = {
  name:      { y: 0.40, maxWidth: 0.60, size: 36, weight: 'semibold', color: 'ink' },
  statement: { y: 0.48, maxWidth: 0.70, size: 14, weight: 'regular',  color: 'muted' },
  event:     { y: 0.555, maxWidth: 0.70, size: 20, weight: 'semibold', color: 'accent' },
  when:      { y: 0.61, maxWidth: 0.70, size: 12, weight: 'regular',  color: 'muted' },
  // Standards may wrap to two lines (see drawSlot), so they get room below.
  ngss:      { y: 0.70, maxWidth: 0.80, size: 9,  weight: 'regular',  color: 'muted' },
  ccss:      { y: 0.785, maxWidth: 0.80, size: 9, weight: 'regular',  color: 'muted' },
  verify:    { y: 0.93, maxWidth: 0.80, size: 8,  weight: 'regular',  color: 'muted' },
}

/** A YYYY-MM-DD date as "October 4, 2026" — read as a calendar day, not an instant. */
export function formatActivityDate(isoDate: string | null): string | null {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}/.test(isoDate)) return null
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

function standardsLine(codes: string[], framework: 'NGSS' | 'CCSS', heading: string): string {
  // Codes only: the full wording is on the credential page (and the artwork back).
  const parts = codes.map(describeStandard).filter((s) => s.framework === framework).map((s) => s.code)
  return parts.length ? `${heading}: ${parts.join(' · ')}` : ''
}

/** The text for each slot. Pure, so the wording is testable without a PDF. */
export function pdCertificateLines(f: PdCertificateFields): Record<PdSlot, string> {
  const unit = f.hours === 1 ? 'hour' : 'hours'
  const when = [formatActivityDate(f.activityDate), f.activityLocation?.trim() || null].filter(Boolean).join(' · ')
  return {
    name: f.recipientName.trim() || 'Educator',
    statement: `completed ${formatPdHours(f.hours)} ${unit} of professional development supporting`,
    event: f.eventTitle.trim(),
    when,
    ngss: standardsLine(f.standards, 'NGSS', 'NGSS'),
    ccss: standardsLine(f.standards, 'CCSS', 'Common Core'),
    verify: `Certificate No. ${f.number} · Verify at ${f.verifyUrl} · ${f.issuer}`,
  }
}

// Aileron and Norwester are the competition print faces (CLAUDE.md: print
// materials only). next.config.mjs traces them into the routes that render this.
const fontCache = new Map<string, Promise<Uint8Array>>()
function loadFont(file: string): Promise<Uint8Array> {
  let p = fontCache.get(file)
  if (!p) {
    p = readFile(path.join(process.cwd(), 'public', 'fonts', file)).then((b) => new Uint8Array(b))
    fontCache.set(file, p)
  }
  return p
}

function hexToRgb(hex: string) {
  const h = hex.replace('#', '')
  return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255)
}

/** Smallest size a line may shrink to before it wraps instead (print legibility). */
const MIN_PRINT_SIZE = 8

/**
 * A list joined by " · " that will not fit on one line at a printable size,
 * split into two lines at the separator nearest the middle. Anything else is
 * left as one line (and shrinks, as names do).
 */
export function wrapList(text: string, fits: (line: string) => boolean): string[] {
  const parts = text.split(' · ')
  if (parts.length < 2 || fits(text)) return [text]
  let best: string[] = [text]
  let bestDiff = Infinity
  for (let i = 1; i < parts.length; i++) {
    const a = parts.slice(0, i).join(' · ')
    const b = parts.slice(i).join(' · ')
    const diff = Math.abs(a.length - b.length)
    if (diff < bestDiff) { best = [a, b]; bestDiff = diff }
  }
  return best
}

function drawSlot(page: PDFPage, text: string, slot: SlotPlacement, fit: Fit, scale: number, fonts: Record<SlotPlacement['weight'], PDFFont>, accentHex: string) {
  if (!text) return
  const font = fonts[slot.weight]
  const maxWidth = fit.width * slot.maxWidth
  const start = slot.size * scale
  const sizeFor = (line: string) => fittedSize((s) => font.widthOfTextAtSize(line, s), start, maxWidth)
  const lines = wrapList(text, (line) => sizeFor(line) >= Math.min(start, MIN_PRINT_SIZE * scale))
  const size = Math.min(...lines.map(sizeFor))
  const color = hexToRgb(slot.color === 'ink' ? tokens.color.ink : slot.color === 'accent' ? accentHex : tokens.color.text.secondary)
  lines.forEach((line, i) => {
    page.drawText(line, {
      x: fit.x + fit.width / 2 - font.widthOfTextAtSize(line, size) / 2,
      y: fit.y + fit.height * (1 - slot.y) - i * size * 1.35,
      size,
      font,
      color,
    })
  })
}

export class PdCertificateArtworkError extends Error {}

export interface PdArtwork {
  front: Artwork | null
  back: Artwork | null
}

/**
 * US Letter landscape. With front artwork: the front with the four fields
 * drawn on it, then the back (when uploaded) as is. Without: one plain page.
 * `accentHex` follows the event theme on the plain page only.
 */
export async function renderPdCertificatePdf(
  fields: PdCertificateFields,
  artwork: PdArtwork,
  { accentHex = tokens.color.primary, layout = DEFAULT_PD_LAYOUT }: { accentHex?: string; layout?: PdLayout } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const [pageW, pageH] = LETTER_LANDSCAPE

  if (artwork.front) {
    const front = await embedArtwork(doc, artwork.front)
    if (!front) throw new PdCertificateArtworkError('The front artwork could not be read. Upload it again as a PNG or JPEG.')
    const back = artwork.back ? await embedArtwork(doc, artwork.back) : null
    if (artwork.back && !back) throw new PdCertificateArtworkError('The back artwork could not be read. Upload it again as a PNG or JPEG.')

    const fonts = {
      aileron: await doc.embedFont(await loadFont('Aileron-SemiBold.otf'), { subset: false }),
      norwester: await doc.embedFont(await loadFont('norwester.otf'), { subset: false }),
    }
    const page = doc.addPage([pageW, pageH])
    const fit = coverFit(front.width, front.height, pageW, pageH)
    page.drawImage(front, fit)
    // Design units → page points for this fit: the art's own height is 1500 units.
    const unit = fit.height / PD_DESIGN_HEIGHT
    const ink = hexToRgb(tokens.color.ink)
    const texts = pdArtworkTexts(fields)
    for (const f of PD_FIELDS) {
      const text = texts[f]
      if (!text) continue
      const font = fonts[PD_FIELD_FONT[f]]
      const p = layout[f]
      const size = fittedSize((s) => font.widthOfTextAtSize(text, s), p.size * unit, fit.width * p.maxWidth)
      page.drawText(text, {
        x: fit.x + fit.width * p.x - font.widthOfTextAtSize(text, size) / 2,
        y: fit.y + fit.height * (1 - p.y),
        size,
        font,
        color: ink,
      })
    }
    if (back) {
      const backPage = doc.addPage([pageW, pageH])
      backPage.drawImage(back, coverFit(back.width, back.height, pageW, pageH))
    }
    markWatermarked(doc)
    return doc.save()
  }

  // Plain fallback: accent rules, a heading, and every field in PD_LAYOUT.
  const fonts = {
    semibold: await doc.embedFont(await loadFont('Aileron-SemiBold.otf'), { subset: false }),
    regular: await doc.embedFont(await loadFont('Aileron-Regular.otf'), { subset: false }),
  }
  const page = doc.addPage([pageW, pageH])
  const fit: Fit = { x: 0, y: 0, width: pageW, height: pageH }
  const accent = hexToRgb(accentHex)
  page.drawRectangle({ x: 0, y: pageH - 14, width: pageW, height: 14, color: accent })
  page.drawRectangle({ x: 0, y: 0, width: pageW, height: 14, color: accent })
  const heading = (text: string, size: number, y: number, font: PDFFont, hex: string) =>
    page.drawText(text, { x: pageW / 2 - font.widthOfTextAtSize(text, size) / 2, y, size, font, color: hexToRgb(hex) })
  heading('STELLR EDUCATION', 13, pageH - 70, fonts.semibold, accentHex)
  heading('Certificate of Professional Development', 28, pageH - 140, fonts.semibold, tokens.color.ink)
  heading('This certifies that', 13, pageH - 190, fonts.regular, tokens.color.text.secondary)
  const lines = pdCertificateLines(fields)
  for (const slot of Object.keys(PD_LAYOUT) as PdSlot[]) {
    drawSlot(page, lines[slot], PD_LAYOUT[slot], fit, 1, fonts, accentHex)
  }
  markWatermarked(doc)
  return doc.save()
}
